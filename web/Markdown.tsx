import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import Markdown, { defaultUrlTransform, type Components, type ExtraProps, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isFromAnotherSite, siteOf, useExternalImagesBlocked } from "./external-images.ts";
import { isLocalImagePath, localImageUrl } from "../shared/images.ts";
import { hints } from "./hints.ts";
import { looksLikeFilePath } from "../shared/file-paths.ts";
import { connection } from "./connection.ts";
import { highlightCode } from "./highlight.ts";
import { blocksOfMessage, linesOfInlines, type Block, type Inline, type LineInline, type Mark } from "../shared/slack-markdown.ts";

/** How long a Copy button says it copied, or couldn't. */
export const COPY_OUTCOME_SHOWN_MS = 1_500;

/** The block's text as written: markdown ends a code block's last line with a line break the author did not write. */
const codeIn = (block: HTMLPreElement | null) => (block?.textContent ?? "").replace(/\n$/, "");

const InsideCodeBlock = createContext(false);

/** The conversation whose files the agent's paths in a text name, or null where there is none to open them in. */
const FilesOfConversation = createContext<string | null>(null);

function CodeBlock({ node: _node, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const block = useRef<HTMLPreElement>(null);
  const [label, setLabel] = useState<"Copy" | "Copied" | "Copy failed">("Copy");
  useEffect(() => {
    if (label === "Copy") return;
    const backToCopy = setTimeout(() => setLabel("Copy"), COPY_OUTCOME_SHOWN_MS);
    return () => clearTimeout(backToCopy);
  }, [label]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codeIn(block.current));
      setLabel("Copied");
    } catch {
      setLabel("Copy failed");
    }
  };
  return (
    <div className="copyable-code">
      <pre ref={block} {...props}>
        <InsideCodeBlock.Provider value={true}>{props.children}</InsideCodeBlock.Provider>
      </pre>
      <button type="button" className={`code-copy ${label === "Copy" ? "" : "shown"}`} onClick={copy}>
        {label}
      </button>
    </div>
  );
}

/** Whether images from other sites show as links, where the page's own image policy isn't the one that applies, as in a plugin's canvas view. */
export const ExternalImagesBlocked = createContext<boolean | null>(null);

/** A badge is an image inside a link, and a link cannot hold another. */
const InsideLink = createContext(false);

function MarkdownLink({ node: _node, children, ...props }: ComponentProps<"a"> & ExtraProps) {
  return (
    <a {...props} target="_blank" rel="noreferrer">
      <InsideLink.Provider value={true}>{children}</InsideLink.Provider>
    </a>
  );
}

/** The default takes a Windows path's drive, as in C:\shots\a.png, for an unsafe protocol and drops the address. */
const keepingLocalImagePaths: UrlTransform = (url, key) => (key === "src" && isLocalImagePath(url) ? url : defaultUrlTransform(url));

function MarkdownImage({ node: _node, ...props }: ComponentProps<"img"> & ExtraProps) {
  const blockedByThisPage = useExternalImagesBlocked();
  const externalImagesBlocked = useContext(ExternalImagesBlocked) ?? blockedByThisPage;
  const insideLink = useContext(InsideLink);
  const conversationId = useContext(FilesOfConversation);
  const source = typeof props.src === "string" ? props.src : "";
  if (conversationId && isLocalImagePath(source)) return <img {...props} src={localImageUrl(conversationId, source)} />;
  if (!externalImagesBlocked || !isFromAnotherSite(source, location.origin)) return <img {...props} />;
  const site = siteOf(source, location.origin);
  const label = props.alt ? `${props.alt} (image from ${site})` : `Image from ${site}`;
  if (insideLink) return <span className="blocked-image">{label}</span>;
  return (
    <a href={source} target="_blank" rel="noreferrer" className="blocked-image" data-hint={hints.blockedImage}>
      {label}
    </a>
  );
}

const fenceNameOf = (className: string | undefined) => className?.match(/(?:^|\s)language-(\S+)/)?.[1] ?? null;

/** The code colored as `language`, plain where that is not a language the highlighter knows; for inside a `.highlighted-code` element. */
export function HighlightedText({ code, language }: { code: string; language: string }) {
  const spans = useMemo(() => highlightCode(code, language), [code, language]);
  if (!spans) return code;
  return spans.map(({ text, type }, index) =>
    type ? (
      <span key={index} className={`token ${type}`}>
        {text}
      </span>
    ) : (
      text
    ),
  );
}

function HighlightedCode({ code, fenceName, className }: { code: string; fenceName: string; className: string | undefined }) {
  return (
    <code className={`${className} highlighted-code`}>
      <HighlightedText code={code} language={fenceName} />
    </code>
  );
}

function MarkdownCode({ node: _node, children, ...props }: ComponentProps<"code"> & ExtraProps) {
  const conversationId = useContext(FilesOfConversation);
  const insideCodeBlock = useContext(InsideCodeBlock);
  const text = typeof children === "string" ? children : "";
  const fenceName = fenceNameOf(props.className);
  if (insideCodeBlock && fenceName && typeof children === "string") return <HighlightedCode code={text} fenceName={fenceName} className={props.className} />;
  if (!conversationId || insideCodeBlock || !looksLikeFilePath(text)) return <code {...props}>{children}</code>;
  return (
    <button type="button" className="file-link" data-hint={hints.openFile} onClick={() => connection.send({ type: "files.open", conversationId, path: text })}>
      <code>{text}</code>
    </button>
  );
}

const markdownComponents: Components = { a: MarkdownLink, img: MarkdownImage, pre: CodeBlock, code: MarkdownCode };

const STREAM_RENDER_INTERVAL_MS = 150;

/** Throttled, not debounced: a debounce would hold the text back for as long as the chunks keep arriving. */
function useThrottledText(text: string) {
  const [shown, setShown] = useState(text);
  const lastShownAt = useRef(0);
  useEffect(() => {
    if (text === shown) return;
    const timer = setTimeout(
      () => {
        lastShownAt.current = Date.now();
        setShown(text);
      },
      Math.max(0, lastShownAt.current + STREAM_RENDER_INTERVAL_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [text, shown]);
  return shown;
}

/** Parsing is the costly part, so a re-render with the same text reuses the last result. */
const RenderedMarkdown = memo(function RenderedMarkdown({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={keepingLocalImagePaths}>
      {text}
    </Markdown>
  );
});

export const MarkdownText = memo(function MarkdownText({ text, conversationId }: { text: string; conversationId?: string }) {
  const shown = useThrottledText(text);
  return (
    <FilesOfConversation.Provider value={conversationId ?? null}>
      <div className="markdown">
        <RenderedMarkdown text={shown} />
      </div>
    </FilesOfConversation.Provider>
  );
});

/** Innermost first, so the elements nest the way the markers do. */
const MARK_TAGS: [Mark, "s" | "em" | "strong"][] = [
  ["strike", "s"],
  ["italic", "em"],
  ["bold", "strong"],
];

function SlackInline({ inline }: { inline: LineInline }) {
  if (inline.kind === "link")
    return (
      <a href={inline.url} target="_blank" rel="noreferrer">
        {inline.text}
      </a>
    );
  if (inline.marks.includes("code")) return <MarkdownCode>{inline.text}</MarkdownCode>;
  return MARK_TAGS.reduce<ReactNode>((content, [mark, Tag]) => (inline.marks.includes(mark) ? <Tag>{content}</Tag> : content), inline.text);
}

/** One element per line, so a blank line keeps its height wherever it falls, even last in a block. */
function SlackLines({ inlines }: { inlines: Inline[] }) {
  return linesOfInlines(inlines).map((line, index) => (
    <div key={index} className="message-line">
      {line.length ? line.map((inline, at) => <SlackInline key={at} inline={inline} />) : <br />}
    </div>
  ));
}

function SlackBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "lines":
      return <SlackLines inlines={block.inlines} />;
    case "code":
      return (
        <CodeBlock>
          <MarkdownCode className={block.language ? `language-${block.language}` : undefined}>{block.code}</MarkdownCode>
        </CodeBlock>
      );
    case "quote":
      return (
        <blockquote>
          <SlackLines inlines={block.inlines} />
        </blockquote>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List>
          {block.items.map((item, index) => (
            <li key={index}>
              <SlackLines inlines={item} />
            </li>
          ))}
        </List>
      );
    }
  }
}

/** A message the person wrote, in Slack's set of markdown, every line kept where it was typed. */
export const SlackMessageText = memo(function SlackMessageText({ text, conversationId }: { text: string; conversationId?: string }) {
  return (
    <FilesOfConversation.Provider value={conversationId ?? null}>
      <div className="markdown slack-message">
        {blocksOfMessage(text).map((block, index) => (
          <SlackBlock key={index} block={block} />
        ))}
      </div>
    </FilesOfConversation.Provider>
  );
});
