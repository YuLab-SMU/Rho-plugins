import { Fragment, useEffect, useState } from 'react';
type Ref = { id: string; version: string };
interface Client {
  call(method: string, input: any): Promise<any>;
}
export function TableComparison({
  client,
  projectId,
  left,
  right
}: {
  client: Client;
  projectId: string;
  left: Ref;
  right: Ref;
}) {
  const [a, setA] = useState<any>(null),
    [b, setB] = useState<any>(null),
    [fields, setFields] = useState<string[]>([]),
    [applied, setApplied] = useState<string[]>([]),
    [page, setPage] = useState<any>(null),
    [error, setError] = useState(''),
    [ref, setRef] = useState<Ref | null>(null),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    let active = true;
    setPage(null);
    setRef(null);
    setError('');
    Promise.all([
      client.call('data.page', {
        projectId,
        resource: left,
        offset: 0,
        limit: 1
      }),
      client.call('data.page', {
        projectId,
        resource: right,
        offset: 0,
        limit: 1
      })
    ]).then(
      ([x, y]) => {
        if (active) {
          setA(x);
          setB(y);
          setFields(
            x.columns
              .filter(
                (c: any) =>
                  c.type === 'number' &&
                  y.columns.some(
                    (d: any) => d.name === c.name && d.type === 'number'
                  )
              )
              .slice(0, 16)
              .map((c: any) => c.name)
          );
        }
      },
      (e) => active && setError(e.message)
    );
    return () => {
      active = false;
    };
  }, [left.id, left.version, right.id, right.version]);
  async function compare() {
    setError('');
    try {
      const r = await client.call('data.compare', {
        projectId,
        left,
        right,
        options: {
          leftKey: a.entityKey,
          rightKey: b.entityKey,
          leftNamespace: a.namespace,
          rightNamespace: b.namespace,
          mapping: 'equal-string',
          join: 'full',
          fields: fields.map((name) => ({ leftField: name, rightField: name }))
        }
      });
      const captured = { id: r.id, version: r.version };
      setRef(captured);
      setApplied([...fields]);
      setOffset(0);
      setPage(
        await client.call('data.page', {
          projectId,
          resource: captured,
          offset: 0,
          limit: 100
        })
      );
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function move(n: number) {
    if (!ref) return;
    try {
      setPage(
        await client.call('data.page', {
          projectId,
          resource: ref,
          offset: n,
          limit: 100
        })
      );
      setOffset(n);
    } catch (e: any) {
      setError(e.message);
    }
  }
  const fmt = (v: any) =>
    v === null
      ? 'Missing value'
      : typeof v === 'number' && !Number.isInteger(v)
        ? v.toPrecision(7)
        : String(v);
  return (
    <section className="rho-comparison" aria-label="Result differences">
      <h3>What changed</h3>
      {error && <p role="alert">{error}</p>}
      {a && b && (
        <details open={!page}>
          <summary>Comparison fields and keys</summary>
          {!a.entityKey || !b.entityKey ? (
            <p>
              Comparison needs declared unique keys and namespaces. Row
              positions cannot identify observations.
            </p>
          ) : (
            <>
              <p>
                Match {a.entityKey} ({a.namespace}) to {b.entityKey} (
                {b.namespace}) by equal string keys. Include rows from both
                versions.
              </p>
              <div className="review-fields">
                {a.columns
                  .filter(
                    (c: any) =>
                      c.type === 'number' &&
                      b.columns.some(
                        (d: any) => d.name === c.name && d.type === 'number'
                      )
                  )
                  .map((c: any) => (
                    <label key={c.name}>
                      <input
                        type="checkbox"
                        checked={fields.includes(c.name)}
                        onChange={() =>
                          setFields((v) =>
                            v.includes(c.name)
                              ? v.filter((n) => n !== c.name)
                              : [...v, c.name].slice(0, 16)
                          )
                        }
                      />
                      {c.name}
                    </label>
                  ))}
              </div>
              <button disabled={!fields.length} onClick={() => void compare()}>
                Compare selected fields
              </button>
            </>
          )}
        </details>
      )}
      {page && (
        <>
          <p>
            {page.resource.coverage.changed} changed rows ·{' '}
            {page.resource.coverage.added} added ·{' '}
            {page.resource.coverage.removed} removed
          </p>
          <div className="review-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Row</th>
                  {applied.map((f) => (
                    <th key={f} colSpan={3}>
                      {f}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th />
                  <th />
                  {applied.map((f) => (
                    <Fragment key={f}>
                      <th key={f + 'before'}>Before</th>
                      <th key={f + 'after'}>After</th>
                      <th key={f + 'delta'}>Change</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row: any) => (
                  <tr key={row.key} data-changed={row.changed}>
                    <th>{row.key}</th>
                    <td>
                      {!row.left_present
                        ? 'Added'
                        : !row.right_present
                          ? 'Removed'
                          : row.changed
                            ? 'Changed'
                            : 'Same'}
                    </td>
                    {applied.map((f, i) => (
                      <Fragment key={f}>
                        <td key={f + 'b'}>
                          {row.left_present
                            ? fmt(row['before_' + i])
                            : 'No row'}
                        </td>
                        <td key={f + 'a'}>
                          {row.right_present
                            ? fmt(row['after_' + i])
                            : 'No row'}
                        </td>
                        <td key={f + 'd'}>
                          {row['delta_' + i] === null
                            ? '—'
                            : fmt(row['delta_' + i])}
                        </td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <button
              disabled={!offset}
              onClick={() => void move(Math.max(0, offset - 100))}
            >
              Previous rows
            </button>{' '}
            {offset + 1}–{Math.min(offset + page.rows.length, page.filtered)} of{' '}
            {page.filtered}{' '}
            <button
              disabled={!page.more}
              onClick={() => void move(page.nextOffset)}
            >
              Next rows
            </button>
          </p>
        </>
      )}
    </section>
  );
}
