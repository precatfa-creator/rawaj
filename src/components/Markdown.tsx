import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders assistant replies as Markdown.
 *
 * The model already writes Markdown — bold labels, bullet lists, and tables for
 * ranked reports. Rendering it as plain text is what put literal `**` on screen.
 *
 * Elements are mapped to React nodes rather than raw HTML: nothing here ever
 * reaches `dangerouslySetInnerHTML`, so model output cannot inject markup. Only
 * assistant messages go through this — a user's own text is shown verbatim,
 * because reformatting what someone typed is worse than leaving it alone.
 *
 * Spacing uses logical properties (ps/pe/ms/me) throughout, since the panel is
 * RTL and lists must indent from the right.
 */
export const Markdown: React.FC<{ children: string }> = ({ children }) => (
  <div className="space-y-2 text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: props => <p className="my-1.5" {...props} />,

        strong: props => <strong className="font-black text-surface-900" {...props} />,
        em: props => <em className="italic" {...props} />,

        ul: props => <ul className="my-1.5 list-disc space-y-1 ps-5" {...props} />,
        ol: props => <ol className="my-1.5 list-decimal space-y-1 ps-5" {...props} />,
        li: props => <li className="ps-1 marker:text-primary-600" {...props} />,

        h1: props => <h3 className="mt-3 mb-1.5 text-base font-black text-surface-900" {...props} />,
        h2: props => <h3 className="mt-3 mb-1.5 text-base font-black text-surface-900" {...props} />,
        h3: props => <h4 className="mt-3 mb-1.5 text-sm font-black text-surface-900" {...props} />,
        h4: props => <h4 className="mt-3 mb-1.5 text-sm font-black text-surface-900" {...props} />,

        // Numbers are the point of this assistant, so tables carry their own
        // horizontal scroll rather than squeezing columns or breaking the bubble.
        table: props => (
          <div className="my-2 -mx-1 overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-xs" {...props} />
          </div>
        ),
        thead: props => <thead className="bg-surface-100" {...props} />,
        th: props => (
          <th className="border border-surface-200 px-2.5 py-1.5 text-start font-black text-surface-700" {...props} />
        ),
        td: props => (
          <td className="border border-surface-200 px-2.5 py-1.5 tabular-nums text-surface-800" {...props} />
        ),

        code: ({ children: code, ...rest }) => (
          <code
            dir="ltr"
            className="rounded bg-surface-100 px-1.5 py-0.5 font-mono text-[0.85em] text-surface-800"
            {...rest}
          >
            {code}
          </code>
        ),
        pre: props => (
          <pre
            dir="ltr"
            className="my-2 overflow-x-auto rounded-xl bg-surface-100 p-3 text-xs [&_code]:bg-transparent [&_code]:p-0"
            {...props}
          />
        ),

        blockquote: props => (
          <blockquote className="my-2 border-s-4 border-primary-200 ps-3 text-surface-600" {...props} />
        ),
        hr: () => <hr className="my-3 border-surface-200" />,

        // The assistant has no reason to link out, but if it ever does, the link
        // must not be able to reach back into this tab.
        a: props => (
          <a
            className="font-bold text-primary-700 underline underline-offset-2"
            target="_blank"
            rel="noreferrer noopener"
            {...props}
          />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);
