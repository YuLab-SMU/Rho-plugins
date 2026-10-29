import { useEffect, useState } from 'react';
import { excerpt } from './ui-card-model.js';
type Ref = { id: string; version: string };
const preview = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  return new TextDecoder().decode(bytes.subarray(0, 65536), {
    stream: bytes.length > 65536
  });
};
export function TextComparison({
  client,
  projectId,
  before,
  after
}: {
  client: { call(method: string, input: any): Promise<any> };
  projectId: string;
  before: Ref;
  after: Ref;
}) {
  const [value, setValue] = useState<{
      before: string;
      after: string;
      change: ReturnType<typeof excerpt>;
    } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setValue(null);
    setError('');
    async function read(resource: Ref) {
      let offset = 0,
        raw = '';
      for (;;) {
        const p = await client.call('resource.read', {
          projectId,
          resource,
          offset
        });
        raw += atob(p.data);
        if (raw.length > 1048576)
          throw new Error(
            'Text comparison is limited to 1 MiB per version; captured files are retained.'
          );
        if (!p.more) break;
        offset = p.nextOffset;
      }
      return new TextDecoder().decode(
        Uint8Array.from(raw, (c) => c.charCodeAt(0))
      );
    }
    Promise.all([read(before), read(after)]).then(
      ([a, b]) =>
        live && setValue({ before: a, after: b, change: excerpt(a, b) }),
      (e) => live && setError(e.message)
    );
    return () => {
      live = false;
    };
  }, [before.id, before.version, after.id, after.version]);
  return (
    <section aria-label="Captured code changes">
      <p>
        First captured version → last captured version. Capture times do not
        prove which bytes a native command used.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : value ? (
        <>
          <pre className="review-code-diff">
            <del>− {value.change.removed}</del>
            {'\n'}
            <ins>+ {value.change.inserted}</ins>
          </pre>
          <details>
            <summary>Show code before and after</summary>
            <h4>First captured version</h4>
            <pre className="review-code-diff">{preview(value.before)}</pre>
            <h4>Last captured version</h4>
            <pre className="review-code-diff">{preview(value.after)}</pre>
            {(new TextEncoder().encode(value.before).length > 65536 ||
              new TextEncoder().encode(value.after).length > 65536) && (
              <p>
                Text previews are limited to 64 KiB; captured files are
                retained.
              </p>
            )}
          </details>
        </>
      ) : (
        <p>Reading captured code…</p>
      )}
    </section>
  );
}
