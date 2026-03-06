import { useState } from 'react';

interface Props {
    data: unknown;
    depth?: number;
    label?: string;
}

export function ObjectTree({ data, depth = 0, label }: Props) {
    const [open, setOpen] = useState(depth < 2);

    const prefix = label !== undefined
        ? <><span className="ot-key">{label}</span><span className="ot-colon">: </span></>
        : null;

    // Primitives
    if (data === null) return <span>{prefix}<span className="ot-null">null</span></span>;
    if (data === undefined) return <span>{prefix}<span className="ot-undefined">undefined</span></span>;
    if (typeof data === 'string') return <span>{prefix}<span className="ot-string">"{data}"</span></span>;
    if (typeof data === 'number') return <span>{prefix}<span className="ot-number">{data}</span></span>;
    if (typeof data === 'boolean') return <span>{prefix}<span className="ot-boolean">{String(data)}</span></span>;

    // Object / Array
    const isArray = Array.isArray(data);
    const keys = Object.keys(data as object);
    const summary = isArray ? `Array(${keys.length})` : 'Object';

    if (keys.length === 0) {
        return <span>{prefix}<span className="ot-empty">{isArray ? '[]' : '{}'}</span></span>;
    }

    return (
        <span className="ot-node">
            {prefix}
            <span className="ot-toggle" onClick={() => setOpen(o => !o)}>
                {open ? '▼' : '▶'} <span className="ot-summary">{summary}</span>
            </span>
            {open && (
                <div className="ot-children">
                    {keys.map(k => (
                        <div key={k} className="ot-row">
                            <ObjectTree
                                data={(data as Record<string, unknown>)[k]}
                                depth={depth + 1}
                                label={k}
                            />
                        </div>
                    ))}
                </div>
            )}
        </span>
    );
}