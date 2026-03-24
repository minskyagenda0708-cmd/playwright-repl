/**
 * Proxy Page
 *
 * Creates a Proxy that looks like Playwright's Page object.
 * Records method calls as a string chain. Nothing executes until `await`.
 * `await` triggers `then()` which sends the chain to the bridge.
 *
 * Rules:
 *   page.* → Proxy (builds chain string)
 *   await page.* → bridge.run(chain) → executes in browser
 *   expect(proxy) → builds expect chain → bridge.run on await
 *   expect(value) → native assertion in Node.js
 */

type BridgeRun = (command: string) => Promise<{ text?: string; isError?: boolean }>;

const PROXY_FLAG = Symbol('isProxy');
const CHAIN_KEY = Symbol('chain');

// Methods that must run on the Node page (CDP) instead of bridge.
// These either take callback args or return non-serializable objects.
const NODE_PAGE_METHODS = new Set([
  'route', 'unroute', 'routeFromHAR', 'unrouteAll',
  'waitForEvent',
]);

function makeProxy(chain: string, bridge: BridgeRun, nodePage?: any): any {
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      // Internal: check if this is a proxy
      if (prop === PROXY_FLAG) return true;
      if (prop === CHAIN_KEY) return chain;

      // await triggers execution
      if (prop === 'then') {
        return (resolve: (v: any) => void, reject: (e: any) => void) => {
          bridge(`await ${chain}`).then(r => {
            if (r.isError) reject(new Error(r.text || 'Bridge error'));
            else {
              // Try to parse the result as JSON
              const text = r.text;
              if (text === undefined || text === '') resolve(undefined);
              else {
                try { resolve(JSON.parse(text)); }
                catch { resolve(text); }
              }
            }
          }).catch(reject);
        };
      }

      // Symbol.toPrimitive — for string concatenation etc.
      if (prop === Symbol.toPrimitive) {
        return () => chain;
      }

      // Node page methods — delegate to real Playwright page (same tab as bridge).
      if (nodePage && chain === 'page' && NODE_PAGE_METHODS.has(String(prop))) {
        return (...args: any[]) => nodePage[String(prop)](...args);
      }

      // Property access → extend chain (returns callable proxy)
      return makeCallableProxy(`${chain}.${String(prop)}`, bridge, nodePage);
    },
  };

  return new Proxy({}, handler);
}

function makeCallableProxy(chain: string, bridge: BridgeRun, nodePage?: any): any {
  // A proxy that can be both called as a function AND have properties accessed
  const fn = function() {};
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === PROXY_FLAG) return true;
      if (prop === CHAIN_KEY) return chain;

      if (prop === 'then') {
        return (resolve: (v: any) => void, reject: (e: any) => void) => {
          bridge(`await ${chain}`).then(r => {
            if (r.isError) reject(new Error(r.text || 'Bridge error'));
            else {
              const text = r.text;
              if (text === undefined || text === '') resolve(undefined);
              else {
                try { resolve(JSON.parse(text)); }
                catch { resolve(text); }
              }
            }
          }).catch(reject);
        };
      }

      if (prop === Symbol.toPrimitive) {
        return () => chain;
      }

      return makeCallableProxy(`${chain}.${String(prop)}`, bridge, nodePage);
    },

    apply(_target, _thisArg, args) {
      const argsStr = args.map(serializeArg).join(', ');
      return makeProxy(`${chain}(${argsStr})`, bridge, nodePage);
    },
  });
}

function serializeArg(arg: unknown): string {
  // Proxy argument → use its chain
  if (arg && typeof arg === 'object' && (arg as any)[PROXY_FLAG]) {
    return (arg as any)[CHAIN_KEY];
  }
  // RegExp → serialize as regex literal
  if (arg instanceof RegExp) {
    return arg.toString();
  }
  // Function → serialize as string
  if (typeof arg === 'function') {
    return arg.toString();
  }
  // Everything else → JSON
  return JSON.stringify(arg);
}

/**
 * Create a proxy page that routes most calls through the bridge.
 * Methods in NODE_PAGE_METHODS delegate to the real Node page (CDP) instead.
 */
export function createPageProxy(bridge: BridgeRun, nodePage?: any): any {
  return makeProxy('page', bridge, nodePage);
}

/**
 * Create a smart expect function.
 * - expect(proxy) → bridge (async Playwright assertions)
 * - expect(value) → native Node.js assertion
 */
export function createExpect(bridge: BridgeRun) {
  // Simple native expect for non-proxy values
  const nativeExpect = (actual: any) => ({
    toBe: (expected: any) => { if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`); },
    toEqual: (expected: any) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`); },
    toBeTruthy: () => { if (!actual) throw new Error(`Expected truthy but got ${JSON.stringify(actual)}`); },
    toBeFalsy: () => { if (actual) throw new Error(`Expected falsy but got ${JSON.stringify(actual)}`); },
    toContain: (expected: any) => { if (!String(actual).includes(expected)) throw new Error(`Expected to contain ${JSON.stringify(expected)}`); },
    toMatch: (pattern: RegExp) => { if (!pattern.test(String(actual))) throw new Error(`Expected to match ${pattern}`); },
    not: {
      toBe: (expected: any) => { if (actual === expected) throw new Error(`Expected not ${JSON.stringify(expected)}`); },
      toContain: (expected: any) => { if (String(actual).includes(expected)) throw new Error(`Expected not to contain ${JSON.stringify(expected)}`); },
    },
  });

  return (target: any) => {
    if (target && target[PROXY_FLAG]) {
      // Proxy → route to bridge
      return makeCallableProxy(`expect(${target[CHAIN_KEY]})`, bridge);
    }
    // Regular value → native assertion
    return nativeExpect(target);
  };
}

export { PROXY_FLAG, CHAIN_KEY };
