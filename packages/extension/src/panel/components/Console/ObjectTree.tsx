import { useState } from 'react';
import type { SerializedValue } from './types';

interface Props {
    data: SerializedValue;
    label?: string;
    depth?: number;
}

function inlineSummary(data: SerializedValue): string {
    if (data.__type === 'null')      return 'null';
    if (data.__type === 'undefined') return 'undefined';
    if (data.__type === 'string')    return `"${data.v}"`;
    if (data.__type === 'number')    return String(data.v);
    if (data.__type === 'boolean')   return String(data.v);
    if (data.__type === 'function')  return `ƒ ${data.name}()`;
    if (data.__type === 'ref')       return `${data.cls} {…}`;
    if (data.__type === 'circular')  return '[Circular]';
    if (data.__type === 'error')     return '[Error]';
    if (data.__type === 'array') {
        const keys = Object.keys(data.props).slice(0, 3);
        const items = keys.map(k => inlineSummary(data.props[k])).join(', ');
        return `[${items}${Object.keys(data.props).length > 3 ? ', …' : ''}]`;
    }
    if (data.__type === 'object') {
        const keys = Object.keys(data.props).slice(0, 3);
        const items = keys.map(k => `${k}: ${inlineSummary(data.props[k])}`).join(', ');
        return `{${items}${Object.keys(data.props).length > 3 ? ', …' : ''}}`;
    }
    return '';
}

export function ObjectTree({ data, label, depth = 0 }: Props) {
    const [open, setOpen] = useState(depth < 1);

    const prefix = label !== undefined
        ? <><span className="ot-key">{label}</span><span className="ot-colon">: </span></>
        : null;

    // Primitives
    if (data.__type === 'null')      return <span>{prefix}<span className="ot-null">null</span></span>;
    if (data.__type === 'undefined') return <span>{prefix}<span className="ot-undefined">undefined</span></span>;
    if (data.__type === 'string')    return <span>{prefix}<span className="ot-string">"{data.v}"</span></span>;
    if (data.__type === 'number')    return <span>{prefix}<span className="ot-number">{data.v}</span></span>;
    if (data.__type === 'boolean')   return <span>{prefix}<span className="ot-boolean">{String(data.v)}</span></span>;
    if (data.__type === 'function')  return <span>{prefix}<span className="ot-summary">ƒ {data.name}()</span></span>;
    if (data.__type === 'ref')       return <span>{prefix}<span className="ot-summary">{data.cls} {'{…}'}</span></span>;
    if (data.__type === 'circular')  return <span>{prefix}<span className="ot-empty">[Circular]</span></span>;
    if (data.__type === 'error')     return <span>{prefix}<span className="ot-empty">[Error]</span></span>;

    // Object / Array
    const isArray = data.__type === 'array';
    const keys = Object.keys(data.props);
    const header = isArray ? `Array(${data.len})` : data.cls;

    if (keys.length === 0) {
        return <span>{prefix}<span className="ot-empty">{isArray ? '[]' : `${data.cls} {}`}</span></span>;
    }

    return (
        <span className="ot-node">
            {prefix}
            <span className="ot-toggle" onClick={() => setOpen(o => !o)}>
                {open ? '▼' : '▶'}{' '}
                <span className="ot-summary">
                    {header} {!open && inlineSummary(data)}
                </span>
            </span>
            {open && (
                <div className="ot-children">
                    {keys.map(k => (
                        <div key={k} className="ot-row">
                            <ObjectTree data={data.props[k]} label={k} depth={depth + 1} />
                        </div>
                    ))}
                </div>
            )}
        </span>
    );
}
