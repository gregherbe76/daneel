import type { ReactNode } from "react";
import type { CommentMention } from "@workspace/api-client-react";

interface Props {
  body: string;
  mentions?: CommentMention[];
}

/**
 * Renders a comment body with `@name` tokens highlighted as chips when
 * the corresponding mention metadata is provided by the API.
 */
export function CommentBody({ body, mentions = [] }: Props) {
  if (!mentions || mentions.length === 0) {
    return <span className="whitespace-pre-wrap leading-relaxed">{body}</span>;
  }

  const names = new Set(mentions.map((m) => m.name));
  // Match @ followed by 1-3 capitalised words (matches "@Alex Rivera" or "@Sam")
  const re = /@([A-Z][\w'-]*(?:\s[A-Z][\w'-]*){0,2})/g;

  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(body)) !== null) {
    const fullMatch = m[0];
    const name = m[1];
    if (!names.has(name)) continue;
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(
      <span
        key={key++}
        className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-medium text-[0.85em] mx-0.5"
      >
        {fullMatch}
      </span>,
    );
    last = m.index + fullMatch.length;
  }
  if (last < body.length) out.push(body.slice(last));

  return <span className="whitespace-pre-wrap leading-relaxed">{out}</span>;
}
