import { createElement as h, createContext, useContext, isValidElement, type ComponentType, type ReactNode } from "react";
import { TokenSpans } from "./syntax/view.js";
import { syntaxKey, type SyntaxLines } from "./syntax/types.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
export interface CodeProps { text: string; language: string }
const CodeContext = createContext<{Code?: ComponentType<CodeProps>; highlights?: Map<string, SyntaxLines>}>({});
function MarkdownPre({children}: {children?: ReactNode}) {
  const {Code, highlights} = useContext(CodeContext);
  if (!isValidElement<{className?:string;children?:ReactNode}>(children)) return h("pre",null,children);
  const text=String(children.props.children ?? "");
  const language=children.props.className?.match(/(?:^|\s)language-(\S+)/)?.[1] ?? "";
  const lines=highlights?.get(syntaxKey(text,language));
  return h("pre",{className:"syntax"},Code ? h(Code,{text,language}) : h("code",null,lines ? lines.flatMap((tokens,i)=>[i ? "\n" : "", h(TokenSpans,{tokens,key:i})]) : text));
}
export function Markdown({ text, Code, highlights }: { text: string; Code?: ComponentType<CodeProps>; highlights?: Map<string,SyntaxLines> }) {
  return h(CodeContext.Provider,{value:{Code,highlights}},h(
    "div",
    { className: "markdown" },
    h(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      skipHtml: true,
      urlTransform: (url) => (/^https?:\/\//i.test(url) ? url : ""),
      components: {
        pre: MarkdownPre,
        a: ({ children, href }) =>
          href
            ? h(
                "a",
                { href, target: "_blank", rel: "noopener noreferrer" },
                children,
                " ↗",
              )
            : h("span", null, children),
        img: ({ alt }) =>
          h("span", { className: "image-placeholder" }, `▧ ${alt || "图片"}`),
        table: ({ children }) =>
          h("div", { className: "table-scroll" }, h("table", null, children)),
      },
      children: text,
    }),
  ));
}
