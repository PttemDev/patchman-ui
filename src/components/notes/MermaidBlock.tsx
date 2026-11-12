import { useEffect, useId, useState } from 'react';
import { useThemeStore } from '@/stores/themeStore';

let mermaidReady: Promise<typeof import('mermaid')['default']> | null = null;

function loadMermaid() {
  // Lazy: mermaid is large and most notes have no diagrams.
  mermaidReady ??= import('mermaid').then((m) => m.default);
  return mermaidReady;
}

// MermaidBlock renders a ```mermaid fence. securityLevel 'strict' makes mermaid
// sanitize labels and drop click handlers/scripts, since note content is
// user-authored and can come from Git.
export function MermaidBlock({ code }: { code: string }) {
  const theme = useThemeStore((s) => s.theme);
  const rawId = useId();
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const id = 'mmd-' + rawId.replace(/[^a-zA-Z0-9]/g, '');
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'default' });
        const out = await mermaid.render(id, code);
        if (!cancelled) { setSvg(out.svg); setError(''); }
      })
      .catch((e: unknown) => {
        // mermaid leaves its error placeholder in the body — remove it.
        document.getElementById('d' + id)?.remove();
        if (!cancelled) { setSvg(''); setError(e instanceof Error ? e.message : String(e)); }
      });
    return () => { cancelled = true; };
  }, [code, theme, rawId]);

  if (error) {
    return (
      <pre className="text-destructive whitespace-pre-wrap"><code>{error}{'\n\n'}{code}</code></pre>
    );
  }
  // mermaid's own (strict) sanitizer produced this SVG.
  return <div className="md-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
