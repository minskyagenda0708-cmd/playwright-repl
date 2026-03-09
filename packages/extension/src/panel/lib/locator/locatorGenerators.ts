/**
 * Copyright (c) Microsoft Corporation.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Ported from playwright-core/src/utils/isomorphic/locatorGenerators.ts
 * Only the JavaScript factory is included — Python/Java/C# are omitted.
 */

import { parseAttributeSelector, parseSelector, stringifySelector } from './selectorParser';
import { escapeWithQuotes, normalizeEscapedRegexQuotes } from './stringUtils';

import type { NestedSelectorBody, ParsedSelector } from './selectorParser';

export type LocatorType = 'default' | 'role' | 'text' | 'label' | 'placeholder' | 'alt' | 'title' | 'test-id' | 'nth' | 'first' | 'last' | 'visible' | 'has-text' | 'has-not-text' | 'has' | 'hasNot' | 'frame' | 'frame-locator' | 'and' | 'or' | 'chain';
export type LocatorBase = 'page' | 'locator' | 'frame-locator';
export type Quote = '\'' | '"' | '`';

type LocatorOptions = {
  attrs?: { name: string, value: string | boolean | number }[],
  exact?: boolean,
  name?: string | RegExp,
  hasText?: string | RegExp,
  hasNotText?: string | RegExp,
};

interface LocatorFactory {
  generateLocator(base: LocatorBase, kind: LocatorType, body: string | RegExp, options?: LocatorOptions): string;
  chainLocators(locators: string[]): string;
}

export function asLocator(selector: string, isFrameLocator = false): string {
  return asLocators(selector, isFrameLocator, 1)[0];
}

export function asLocators(selector: string, isFrameLocator = false, maxOutputSize = 20, preferredQuote?: Quote): string[] {
  try {
    return innerAsLocators(new JavaScriptLocatorFactory(preferredQuote), parseSelector(selector), isFrameLocator, maxOutputSize);
  } catch {
    return [selector];
  }
}

function innerAsLocators(factory: LocatorFactory, parsed: ParsedSelector, isFrameLocator = false, maxOutputSize = 20): string[] {
  const parts = [...parsed.parts];
  const tokens: string[][] = [];
  let nextBase: LocatorBase = isFrameLocator ? 'frame-locator' : 'page';
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const base = nextBase;
    nextBase = 'locator';

    if (part.name === 'internal:describe')
      continue;
    if (part.name === 'nth') {
      if (part.body === '0')
        tokens.push([factory.generateLocator(base, 'first', ''), factory.generateLocator(base, 'nth', '0')]);
      else if (part.body === '-1')
        tokens.push([factory.generateLocator(base, 'last', ''), factory.generateLocator(base, 'nth', '-1')]);
      else
        tokens.push([factory.generateLocator(base, 'nth', part.body as string)]);
      continue;
    }
    if (part.name === 'visible') {
      tokens.push([factory.generateLocator(base, 'visible', part.body as string), factory.generateLocator(base, 'default', `visible=${part.body}`)]);
      continue;
    }
    if (part.name === 'internal:text') {
      const { exact, text } = detectExact(part.body as string);
      tokens.push([factory.generateLocator(base, 'text', text, { exact })]);
      continue;
    }
    if (part.name === 'internal:has-text') {
      const { exact, text } = detectExact(part.body as string);
      if (!exact) {
        tokens.push([factory.generateLocator(base, 'has-text', text, { exact })]);
        continue;
      }
    }
    if (part.name === 'internal:has-not-text') {
      const { exact, text } = detectExact(part.body as string);
      if (!exact) {
        tokens.push([factory.generateLocator(base, 'has-not-text', text, { exact })]);
        continue;
      }
    }
    if (part.name === 'internal:has') {
      const inners = innerAsLocators(factory, (part.body as NestedSelectorBody).parsed, false, maxOutputSize);
      tokens.push(inners.map(inner => factory.generateLocator(base, 'has', inner)));
      continue;
    }
    if (part.name === 'internal:has-not') {
      const inners = innerAsLocators(factory, (part.body as NestedSelectorBody).parsed, false, maxOutputSize);
      tokens.push(inners.map(inner => factory.generateLocator(base, 'hasNot', inner)));
      continue;
    }
    if (part.name === 'internal:and') {
      const inners = innerAsLocators(factory, (part.body as NestedSelectorBody).parsed, false, maxOutputSize);
      tokens.push(inners.map(inner => factory.generateLocator(base, 'and', inner)));
      continue;
    }
    if (part.name === 'internal:or') {
      const inners = innerAsLocators(factory, (part.body as NestedSelectorBody).parsed, false, maxOutputSize);
      tokens.push(inners.map(inner => factory.generateLocator(base, 'or', inner)));
      continue;
    }
    if (part.name === 'internal:chain') {
      const inners = innerAsLocators(factory, (part.body as NestedSelectorBody).parsed, false, maxOutputSize);
      tokens.push(inners.map(inner => factory.generateLocator(base, 'chain', inner)));
      continue;
    }
    if (part.name === 'internal:label') {
      const { exact, text } = detectExact(part.body as string);
      tokens.push([factory.generateLocator(base, 'label', text, { exact })]);
      continue;
    }
    if (part.name === 'internal:role') {
      const attrSelector = parseAttributeSelector(part.body as string, true);
      const options: LocatorOptions = { attrs: [] };
      for (const attr of attrSelector.attributes) {
        if (attr.name === 'name') {
          options.exact = attr.caseSensitive;
          options.name = attr.value;
        } else {
          if (attr.name === 'level' && typeof attr.value === 'string')
            attr.value = +attr.value;
          options.attrs!.push({ name: attr.name === 'include-hidden' ? 'includeHidden' : attr.name, value: attr.value });
        }
      }
      tokens.push([factory.generateLocator(base, 'role', attrSelector.name, options)]);
      continue;
    }
    if (part.name === 'internal:testid') {
      const attrSelector = parseAttributeSelector(part.body as string, true);
      const { value } = attrSelector.attributes[0];
      tokens.push([factory.generateLocator(base, 'test-id', value)]);
      continue;
    }
    if (part.name === 'internal:attr') {
      const attrSelector = parseAttributeSelector(part.body as string, true);
      const { name, value, caseSensitive } = attrSelector.attributes[0];
      const text = value as string | RegExp;
      const exact = !!caseSensitive;
      if (name === 'placeholder') {
        tokens.push([factory.generateLocator(base, 'placeholder', text, { exact })]);
        continue;
      }
      if (name === 'alt') {
        tokens.push([factory.generateLocator(base, 'alt', text, { exact })]);
        continue;
      }
      if (name === 'title') {
        tokens.push([factory.generateLocator(base, 'title', text, { exact })]);
        continue;
      }
    }
    if (part.name === 'internal:control' && (part.body as string) === 'enter-frame') {
      const lastTokens = tokens[tokens.length - 1];
      const lastPart = parts[index - 1];
      const transformed = lastTokens.map(token => factory.chainLocators([token, factory.generateLocator(base, 'frame', '')]));
      if (['xpath', 'css'].includes(lastPart.name)) {
        transformed.push(
          factory.generateLocator(base, 'frame-locator', stringifySelector({ parts: [lastPart] })),
          factory.generateLocator(base, 'frame-locator', stringifySelector({ parts: [lastPart] }, true))
        );
      }
      lastTokens.splice(0, lastTokens.length, ...transformed);
      nextBase = 'frame-locator';
      continue;
    }

    const nextPart = parts[index + 1];
    const selectorPart = stringifySelector({ parts: [part] });
    const locatorPart = factory.generateLocator(base, 'default', selectorPart);

    if (nextPart && ['internal:has-text', 'internal:has-not-text'].includes(nextPart.name)) {
      const { exact, text } = detectExact(nextPart.body as string);
      if (!exact) {
        const nextLocatorPart = factory.generateLocator('locator', nextPart.name === 'internal:has-text' ? 'has-text' : 'has-not-text', text, { exact });
        const options: LocatorOptions = {};
        if (nextPart.name === 'internal:has-text')
          options.hasText = text;
        else
          options.hasNotText = text;
        const combinedPart = factory.generateLocator(base, 'default', selectorPart, options);
        tokens.push([factory.chainLocators([locatorPart, nextLocatorPart]), combinedPart]);
        index++;
        continue;
      }
    }

    let locatorPartWithEngine: string | undefined;
    if (['xpath', 'css'].includes(part.name)) {
      const selectorPartWithEngine = stringifySelector({ parts: [part] }, true);
      locatorPartWithEngine = factory.generateLocator(base, 'default', selectorPartWithEngine);
    }
    tokens.push([locatorPart, locatorPartWithEngine].filter(Boolean) as string[]);
  }
  return combineTokens(factory, tokens, maxOutputSize);
}

function combineTokens(factory: LocatorFactory, tokens: string[][], maxOutputSize: number): string[] {
  const currentTokens = tokens.map(() => '');
  const result: string[] = [];
  const visit = (index: number): boolean => {
    if (index === tokens.length) {
      result.push(factory.chainLocators(currentTokens));
      return result.length < maxOutputSize;
    }
    for (const taken of tokens[index]) {
      currentTokens[index] = taken;
      if (!visit(index + 1))
        return false;
    }
    return true;
  };
  visit(0);
  return result;
}

function detectExact(text: string): { exact?: boolean, text: string | RegExp } {
  let exact = false;
  const match = text.match(/^\/(.*)\/([igm]*)$/);
  if (match)
    return { text: new RegExp(match[1], match[2]) };
  if (text.endsWith('"')) {
    text = JSON.parse(text);
    exact = true;
  } else if (text.endsWith('"s')) {
    text = JSON.parse(text.substring(0, text.length - 1));
    exact = true;
  } else if (text.endsWith('"i')) {
    text = JSON.parse(text.substring(0, text.length - 1));
    exact = false;
  }
  return { exact, text };
}

class JavaScriptLocatorFactory implements LocatorFactory {
  constructor(private preferredQuote?: Quote) {}

  generateLocator(base: LocatorBase, kind: LocatorType, body: string | RegExp, options: LocatorOptions = {}): string {
    switch (kind) {
      case 'default':
        if (options.hasText !== undefined)
          return `locator(${this.quote(body as string)}, { hasText: ${this.toHasText(options.hasText)} })`;
        if (options.hasNotText !== undefined)
          return `locator(${this.quote(body as string)}, { hasNotText: ${this.toHasText(options.hasNotText)} })`;
        return `locator(${this.quote(body as string)})`;
      case 'frame-locator':
        return `frameLocator(${this.quote(body as string)})`;
      case 'frame':
        return `contentFrame()`;
      case 'nth':
        return `nth(${body})`;
      case 'first':
        return `first()`;
      case 'last':
        return `last()`;
      case 'visible':
        return `filter({ visible: ${body === 'true' ? 'true' : 'false'} })`;
      case 'role': {
        const attrs: string[] = [];
        if (isRegExp(options.name)) {
          attrs.push(`name: ${this.regexToSourceString(options.name)}`);
        } else if (typeof options.name === 'string') {
          attrs.push(`name: ${this.quote(options.name)}`);
          if (options.exact)
            attrs.push(`exact: true`);
        }
        for (const { name, value } of options.attrs!)
          attrs.push(`${name}: ${typeof value === 'string' ? this.quote(value) : value}`);
        const attrString = attrs.length ? `, { ${attrs.join(', ')} }` : '';
        return `getByRole(${this.quote(body as string)}${attrString})`;
      }
      case 'has-text':
        return `filter({ hasText: ${this.toHasText(body)} })`;
      case 'has-not-text':
        return `filter({ hasNotText: ${this.toHasText(body)} })`;
      case 'has':
        return `filter({ has: ${body} })`;
      case 'hasNot':
        return `filter({ hasNot: ${body} })`;
      case 'and':
        return `and(${body})`;
      case 'or':
        return `or(${body})`;
      case 'chain':
        return `locator(${body})`;
      case 'test-id':
        return `getByTestId(${this.toTestIdValue(body)})`;
      case 'text':
        return this.toCallWithExact('getByText', body, !!options.exact);
      case 'alt':
        return this.toCallWithExact('getByAltText', body, !!options.exact);
      case 'placeholder':
        return this.toCallWithExact('getByPlaceholder', body, !!options.exact);
      case 'label':
        return this.toCallWithExact('getByLabel', body, !!options.exact);
      case 'title':
        return this.toCallWithExact('getByTitle', body, !!options.exact);
      default:
        throw new Error('Unknown selector kind ' + kind);
    }
  }

  chainLocators(locators: string[]): string {
    return locators.join('.');
  }

  private regexToSourceString(re: RegExp) {
    return normalizeEscapedRegexQuotes(String(re));
  }

  private toCallWithExact(method: string, body: string | RegExp, exact: boolean) {
    if (isRegExp(body))
      return `${method}(${this.regexToSourceString(body)})`;
    return exact ? `${method}(${this.quote(body)}, { exact: true })` : `${method}(${this.quote(body)})`;
  }

  private toHasText(body: string | RegExp) {
    if (isRegExp(body))
      return this.regexToSourceString(body);
    return this.quote(body);
  }

  private toTestIdValue(value: string | RegExp): string {
    if (isRegExp(value))
      return this.regexToSourceString(value);
    return this.quote(value);
  }

  private quote(text: string) {
    return escapeWithQuotes(text, this.preferredQuote ?? '\'');
  }
}

function isRegExp(obj: unknown): obj is RegExp {
  return obj instanceof RegExp;
}
