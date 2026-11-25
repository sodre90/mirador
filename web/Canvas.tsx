import type { PlanEntry } from "@agentclientprotocol/sdk/unstable";
import { Fragment, createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { buildCanvasDocument, canvasHiddenMessage, canvasPageMessage, canvasRoomMessage, canvasShellUrl, canvasTextScaleMessage, canvasThemeMessage, isCanvasFrameMessage, type CanvasFrameMessage, type CanvasPagePolicy } from "../shared/canvas-document.ts";
import { appKey, type AppDocumentState, type InstalledApp, type OpenApp } from "../shared/apps.ts";
import { answerPicking, answersSummary, answerTo, pickedIn, questionsOf } from "../shared/ask.ts";
import type { AskAnswerEntry, AskItem, AskQuestion, CanvasItem, ShowItem } from "../shared/model.ts";
import { AppView } from "./AppView.tsx";
import { BarMenu, type BarMenuEntry } from "./BarMenu.tsx";
import { connection } from "./connection.ts";
import { settledEditNote, type EditRequest } from "./edit-approval.ts";
import { ChangesView } from "./Changes.tsx";
import { ChecklistView, currentTabItem, isTabItem, tabCount, useFlashOnAgentEdit } from "./Checklist.tsx";
import { EditApproval } from "./EditApproval.tsx";
import { FONT_SCALES, useFontScale } from "./font-scale.ts";
import { FRAME_BORDERS, fittedStyles, type ContentSize } from "./frame-fit.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { usePageExport } from "./PageExport.tsx";
import { useFindOnPageRequests, usePageFind, type FindTarget } from "./PageFind.tsx";
import { usePageMarks } from "./PageMarks.tsx";
import { canOpenItemWindows, openItemWindow } from "./item-window.ts";
import { PluginItemView } from "./PluginItemView.tsx";
import { SettledNoteLine, type SettledNote } from "./SettledNote.tsx";
import { shortcutKeys } from "./shortcuts.ts";
import { onShownThemeChange, shownTheme } from "./theme.ts";
import { formatClockTime, formatFullTime } from "./timestamps.ts";
import { useTypingAidAttributes } from "./typing-aids.ts";
import { openWebAddress } from "./outside-links.ts";
import { opensWithRoom, takeArrivedReview } from "./review-placement.ts";
import { roomOf } from "./plugin-settings.ts";
import { FullscreenToggle, PaneGrip, usePaneFullscreen } from "./Workspace.tsx";
import { WorkspaceTabView, type WorkspacePluginTab } from "./WorkspaceTabView.tsx";
import { stepPressedOn, useOwnMouseSteps } from "./mouse-steps.ts";
import { isStep } from "./visit-trail.ts";

const words = t.canvas;

/** Content as wide as the viewport would otherwise widen the frame that measures it without end. */
const MAX_CONTENT_WIDTH = 2400;
/** Past this, a page's unwrapped lines are prose that reads fine wrapped, rather than a layout that needs the room. */
const MAX_UNWRAPPED_WIDTH_ASKED = 720;

function MarkBatchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.2h11v7.3H8.2l-3 2.5v-2.5h-2.7z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5 6h6M5 8h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function useElementWidth(element: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    if (target.clientWidth !== width) setWidth(target.clientWidth);
  });

  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new ResizeObserver(() => setWidth(target.clientWidth));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return width;
}

/** A wheel turn reported by a page that could not use it: the panel holding the page scrolls by it instead. */
function scrollPanelBy(frame: HTMLIFrameElement | null, wheel: { deltaY: number; deltaMode: number }) {
  const panel = scrollableAncestor(frame);
  if (!panel) return;
  const lines = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? panel.clientHeight : 1;
  panel.scrollBy({ top: wheel.deltaY * lines });
}

function scrollableAncestor(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

const openable = (href: unknown): href is string => typeof href === "string" && /^(https?|mailto):/i.test(href);

/** A web link goes the way the app's own do, so the desktop app hands it to the browser rather than dropping it. */
const openFromPage = (href: string) => (/^mailto:/i.test(href) ? window.open(href, "_blank", "noopener,noreferrer") : openWebAddress(href));

/** Whether the canvas is in sight, or kept live behind another conversation's canvas. */
export const CanvasShown = createContext(true);

export function CanvasFrame({
  frameId,
  html,
  assetsOrigin,
  className,
  fitsContent = false,
  padded = fitsContent,
  policy,
  markable = false,
  panelFinds = false,
  followsTextSize = false,
  allow,
  onRendered,
  onContentWidth,
  onMessage,
  frameRef,
}: {
  frameId: string;
  html: string;
  assetsOrigin: string;
  className?: string;
  fitsContent?: boolean;
  /** A little room at the page's sides; a page that fits its content has it unless it says otherwise. */
  padded?: boolean;
  policy?: CanvasPagePolicy;
  /** Whether the user may mark part of the page to ask the agent about; fixed for the frame's life, as a change reloads the page. */
  markable?: boolean;
  /** Whether the panel's find bar finds in the page, so ⌘F there opens it instead of the browser's; fixed for the frame's life. */
  panelFinds?: boolean;
  /** Whether the page zooms with the text size Settings chose, as a page the agent wrote does: plugin views and apps size their text themselves. */
  followsTextSize?: boolean;
  /** Browser features the page may use, as the iframe's allow attribute names them. */
  allow?: string;
  onRendered?: (errors: string[]) => void;
  onContentWidth?: (width: number) => void;
  /** Every message the page posts, for what the frame itself doesn't handle, such as an app view's operations. */
  onMessage?: (message: CanvasFrameMessage) => void;
  /** For the panel to reach the page's frame, as copying it as an image does. */
  frameRef?: RefObject<HTMLIFrameElement | null>;
}) {
  const ownFrame = useRef<HTMLIFrameElement>(null);
  const frame = frameRef ?? ownFrame;
  const box = useRef<HTMLDivElement>(null);
  const roomWidth = useElementWidth(box);
  const [fontScale] = useFontScale();
  const zoom = followsTextSize ? FONT_SCALES[fontScale] : 1;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [errors, setErrors] = useState<string[]>([]);
  const [contentSize, setContentSize] = useState<ContentSize>();
  const [columnWidthAsked, setColumnWidthAsked] = useState(0);
  const [unwrappedWidth, setUnwrappedWidth] = useState(0);
  // Neither the theme nor the zoom is a dependency: changing one would reload the page, so it reaches a shown page by message instead.
  const imagesFromOtherSites = policy?.imagesFromOtherSites ?? false;
  const measuresNaturalWidth = onContentWidth !== undefined;
  const document = useMemo(
    () => buildCanvasDocument(html, frameId, assetsOrigin, shownTheme(), {
        padded,
        policy: { imagesFromOtherSites },
        markable,
        panelFinds,
        measuresNaturalWidth,
        followsTextSize,
        fitsContent,
        textScale: zoomRef.current,
      }),
    [html, frameId, assetsOrigin, padded, imagesFromOtherSites, markable, panelFinds, measuresNaturalWidth, followsTextSize, fitsContent],
  );
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const onContentWidthRef = useRef(onContentWidth);
  onContentWidthRef.current = onContentWidth;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const shellLoaded = useRef<Window | null>(null);
  const pageSentTo = useRef<Window | null>(null);
  const sendPage = () => {
    const shell = frame.current?.contentWindow;
    if (!shell) return;
    pageSentTo.current = shell;
    shell.postMessage(canvasPageMessage(document), "*");
  };

  useEffect(() => {
    setErrors([]);
    setContentSize(undefined);
    setColumnWidthAsked(0);
    setUnwrappedWidth(0);
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !isCanvasFrameMessage(event.data)) return;
      const message = event.data;
      if (message.kind === "shell-ready") sendPage();
      if (message.kind === "error") setErrors((current) => [...current, message.message]);
      if (message.kind === "rendered") onRenderedRef.current?.(message.errors);
      if (message.kind === "size") {
        const neededWidth = message.overflowWidth && Math.min(message.overflowWidth, MAX_CONTENT_WIDTH);
        setContentSize({ height: message.height, width: neededWidth });
        // Kept once the column gives it: the page then fits its column, which would otherwise take the width away again.
        if (neededWidth) setColumnWidthAsked(neededWidth);
        if (message.naturalWidth) setUnwrappedWidth(Math.min(message.naturalWidth, MAX_UNWRAPPED_WIDTH_ASKED));
      }
      if (message.kind === "wheel") scrollPanelBy(frame.current, message);
      if (message.kind === "mouse-step" && frame.current && isStep(message.step)) stepPressedOn(frame.current, message.step);
      if (message.kind === "open-link" && openable(message.href)) openFromPage(message.href);
      onMessageRef.current?.(message);
    };
    window.addEventListener("message", listener);
    // React keeps a hidden conversation's frames loading but runs no effects there, so a shell that became ready meanwhile was never answered.
    const shell = frame.current?.contentWindow;
    if (shell && shellLoaded.current === shell && pageSentTo.current !== shell) sendPage();
    return () => window.removeEventListener("message", listener);
  }, [document]);

  useEffect(() => {
    const wantedWidth = Math.max(columnWidthAsked, unwrappedWidth);
    if (wantedWidth) onContentWidthRef.current?.(wantedWidth);
  }, [columnWidthAsked, unwrappedWidth]);

  useEffect(() => onShownThemeChange(() => postThemeTo(frame)), []);
  useEffect(() => {
    if (!followsTextSize) return;
    setColumnWidthAsked(0);
    postTextScaleTo(frame, zoom);
  }, [zoom]);

  const shown = useContext(CanvasShown);
  useEffect(() => {
    if (!shown) frame.current?.contentWindow?.postMessage(canvasHiddenMessage(), "*");
  }, [shown]);

  // A page in a frame sized to its content takes its column's width as its window's, rather than the frame's, which
  // grows with it. Until it reports the size it has there, its frame keeps the one it has: drawn at the column's width
  // meanwhile, a page wider than it would flicker at each step of a drag.
  const pageRoomWidth = roomWidth - FRAME_BORDERS;
  useEffect(() => {
    if (!fitsContent || pageRoomWidth <= 0) return;
    frame.current?.contentWindow?.postMessage(canvasRoomMessage(pageRoomWidth), "*");
  }, [pageRoomWidth]);

  const fitted = fitsContent ? fittedStyles(contentSize, roomWidth) : {};
  return (
    <div ref={box} className={`canvas-frame ${className ?? ""}`} style={fitted.box}>
      <iframe
        key={document}
        ref={frame}
        sandbox="allow-scripts"
        allow={allow}
        src={canvasShellUrl(assetsOrigin, { imagesFromOtherSites })}
        title={frameId}
        style={fitted.frame}
        onLoad={() => {
          shellLoaded.current = frame.current?.contentWindow ?? null;
          postThemeTo(frame);
          if (followsTextSize) postTextScaleTo(frame, zoomRef.current);
        }}
      />
      {errors.length > 0 && (
        <ul className="frame-errors">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Also on load: a theme chosen while the page was still opening went to the frame's blank window and was lost. */
function postThemeTo(frame: RefObject<HTMLIFrameElement | null>) {
  frame.current?.contentWindow?.postMessage(canvasThemeMessage(shownTheme()), "*");
}

function postTextScaleTo(frame: RefObject<HTMLIFrameElement | null>, zoom: number) {
  frame.current?.contentWindow?.postMessage(canvasTextScaleMessage(zoom), "*");
}

function reportRender(itemId: string) {
  return (errors: string[]) => connection.send({ type: "canvas.report", itemId, errors });
}

const SOMETHING_ELSE = Symbol("something else");

interface AskDraft {
  choice: string | typeof SOMETHING_ELSE | null;
  /** For a question that takes several: the labels ticked, and whether the user's own answer is ticked too. */
  ticked: string[];
  otherTicked: boolean;
  other: string;
  note: string;
}

const emptyDraft = (): AskDraft => ({ choice: null, ticked: [], otherTicked: false, other: "", note: "" });

function pickedSoFar({ choice, ticked, otherTicked, other }: AskDraft, question: AskQuestion): AskAnswerEntry | null {
  if (question.multiple) return answerPicking(question, ticked, otherTicked ? other : "");
  const label = choice === SOMETHING_ELSE ? other.trim() : choice;
  return label ? { label } : null;
}

function draftAnswer(draft: AskDraft, question: AskQuestion): AskAnswerEntry | null {
  const picked = pickedSoFar(draft, question);
  return picked && { ...picked, note: draft.note.trim() || undefined };
}

const isGiven = (answer: AskAnswerEntry | null): answer is AskAnswerEntry => answer !== null;

interface AskProgress {
  drafts: AskDraft[];
  page: number;
  note: string;
}

/** What the user has answered so far and which question they are on, kept for as long as the page lives, so leaving the conversation and coming back loses nothing. */
const askProgressByItem = new Map<string, AskProgress>();

function useAskProgress(itemId: string, questionCount: number) {
  const [progress, setProgress] = useState<AskProgress>(() => askProgressByItem.get(itemId) ?? { drafts: Array.from({ length: questionCount }, emptyDraft), page: 0, note: "" });
  useEffect(() => {
    askProgressByItem.set(itemId, progress);
  }, [itemId, progress]);
  return {
    drafts: progress.drafts,
    page: progress.page,
    setPage: (page: number) => setProgress((current) => ({ ...current, page })),
    note: progress.note,
    setNote: (note: string) => setProgress((current) => ({ ...current, note })),
    changeDraft: (index: number, change: Partial<AskDraft>) =>
      setProgress((current) => ({ ...current, drafts: current.drafts.map((draft, at) => (at === index ? { ...draft, ...change } : draft)) })),
  };
}

function AskQuestionFields({
  question,
  draft,
  onChange,
  waiting,
  answer,
  idPrefix,
  radioName,
  assetsOrigin,
}: {
  question: AskQuestion;
  draft: AskDraft;
  onChange: (change: Partial<AskDraft>) => void;
  waiting: boolean;
  answer: AskAnswerEntry | undefined;
  idPrefix: string;
  radioName: string;
  assetsOrigin: string;
}) {
  const typingAidAttributes = useTypingAidAttributes();
  const [previewWidths, setPreviewWidths] = useState<Record<string, number>>({});
  const widestPreview = Math.max(0, ...Object.values(previewWidths));
  const optionsStyle = {
    ...(widestPreview > 0 && { "--preview-width": `${widestPreview}px` }),
    ...(question.optionWidth && { "--option-width": `${question.optionWidth}px` }),
  } as CSSProperties;
  const multiple = question.multiple === true;
  const inputType = multiple ? "checkbox" : "radio";
  const given = answer && pickedIn(question, answer);
  const chosenInDraft = multiple ? draft.ticked : [draft.choice];
  const chosenLabels = waiting ? chosenInDraft : (given?.options ?? []);
  const isChosen = (label: string) => chosenLabels.includes(label);
  const otherChosen = multiple ? draft.otherTicked : draft.choice === SOMETHING_ELSE;
  const toggle = (label: string) => onChange({ ticked: draft.ticked.includes(label) ? draft.ticked.filter((each) => each !== label) : [...draft.ticked, label] });
  const ownAnswerGiven = waiting ? undefined : given?.own;

  return (
    <>
      {question.html && <CanvasFrame frameId={`${idPrefix}-context`} html={question.html} assetsOrigin={assetsOrigin} className="ask-context" panelFinds fitsContent followsTextSize />}
      <div className="ask-options" role={multiple ? "group" : "radiogroup"} aria-label={question.question} style={optionsStyle}>
        {question.options.map((option, index) => (
          <label key={option.label} className={`ask-option ${isChosen(option.label) ? "chosen" : ""}`}>
            <span className="ask-option-head">
              <input
                type={inputType}
                name={radioName}
                aria-label={option.label}
                checked={isChosen(option.label)}
                disabled={!waiting}
                onChange={() => (multiple ? toggle(option.label) : onChange({ choice: option.label }))}
              />
              <span className="ask-option-label">{option.label}</span>
              {option.recommended && <span className="ask-option-recommended">{words.ask.recommended}</span>}
            </span>
            {option.description && <span className="ask-option-description">{option.description}</span>}
            {option.html && (
              <CanvasFrame
                frameId={`${idPrefix}-option-${index}`}
                html={option.html}
                assetsOrigin={assetsOrigin}
                className="ask-preview"
                panelFinds
                fitsContent
                followsTextSize
                onContentWidth={(width) => setPreviewWidths((current) => ({ ...current, [option.label]: width }))}
              />
            )}
          </label>
        ))}
        {ownAnswerGiven !== undefined && (
          <div className="ask-option chosen ask-own-answer">
            <span className="ask-option-head">
              <input type={inputType} name={radioName} aria-label={words.ask.ownAnswer} checked disabled readOnly />
              <span className="ask-option-label">{words.ask.ownAnswer}</span>
            </span>
            <span className="ask-own-answer-text">{ownAnswerGiven}</span>
          </div>
        )}
      </div>
      {waiting && (
        <div className="ask-extras">
          {question.allowOther && (
            <label className={`ask-other ${otherChosen ? "chosen" : ""}`}>
              <input
                type={inputType}
                name={radioName}
                aria-label={words.ask.somethingElseLabel}
                checked={otherChosen}
                onChange={() => (multiple ? onChange({ otherTicked: !draft.otherTicked }) : onChange({ choice: SOMETHING_ELSE }))}
              />
              <textarea
                {...typingAidAttributes}
                rows={Math.min(6, draft.other.split("\n").length)}
                value={draft.other}
                placeholder={words.ask.somethingElse}
                aria-label={words.ask.ownAnswer}
                onFocus={() => !multiple && onChange({ choice: SOMETHING_ELSE })}
                onChange={(event) => onChange({ other: event.target.value, ...(multiple && { otherTicked: event.target.value.trim() !== "" }) })}
                onKeyDown={answerOnEnter}
              />
            </label>
          )}
          <textarea
            {...typingAidAttributes}
            value={draft.note}
            placeholder={words.ask.note}
            onChange={(event) => onChange({ note: event.target.value })}
            onKeyDown={answerOnEnter}
          />
        </div>
      )}
    </>
  );
}

/** As in the message box: Enter answers, Shift+Enter starts a new line. */
function answerOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

const deliveredNote = (answer: NonNullable<AskItem["answer"]>) => (answer.deliveredAs === "tool-result" ? words.ask.returnedToAgent : words.ask.sentAsNextMessage);

function AnsweredSeveral({ answer, count }: { answer: NonNullable<AskItem["answer"]>; count: number }) {
  return (
    <div className="ask-answer">
      {words.ask.youAnsweredCount(count)}
      <span className="delivered">{deliveredNote(answer)}</span>
      {answer.note && <div>{words.ask.noteOnAllAnswers(answer.note)}</div>}
    </div>
  );
}

function AskView({
  item,
  pagesBefore,
  assetsOrigin,
  formRef,
  answerable,
  inRoom,
}: {
  item: AskItem;
  pagesBefore: ShowItem[];
  assetsOrigin: string;
  formRef: RefObject<HTMLFormElement | null>;
  answerable: boolean;
  /** Its room votes on it and confirms the answer there, so here it is only read. */
  inRoom: boolean;
}) {
  const questions = questionsOf(item);
  const several = item.questions !== undefined;
  const waiting = item.status === "waiting" && answerable;
  const typingAidAttributes = useTypingAidAttributes();
  const { drafts, page, setPage, changeDraft, note, setNote } = useAskProgress(item.id, questions.length);
  const answers = drafts.map((draft, index) => draftAnswer(draft, questions[index]!));
  const onReviewPage = several && waiting && page >= questions.length;
  const shownQuestion = questions[Math.min(page, questions.length - 1)];
  const questionIndex = several ? Math.min(page, questions.length - 1) : 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (several) {
      if (!onReviewPage) {
        if (answers[questionIndex]) setPage(page + 1);
        return;
      }
      if (!answers.every(isGiven)) return;
      connection.send({ type: "ask.answer", itemId: item.id, label: answersSummary(answers), answers, note: note.trim() || undefined });
      return;
    }
    const [answer] = answers;
    if (answer) connection.send({ type: "ask.answer", itemId: item.id, ...answer });
  };

  if (!shownQuestion) return null;
  const pagesBeforeShown = !several || page === 0 ? pagesBefore : [];
  const currentAnswer = answers[questionIndex];
  const howToAnswer = shownQuestion.multiple ? words.ask.tickOptions : words.ask.pickAnOption;
  const answerSoFar = currentAnswer ? (
    <>
      {words.ask.yourAnswer} <strong>{currentAnswer.label}</strong>
    </>
  ) : (
    howToAnswer
  );

  return (
    <form className="ask" ref={formRef} onSubmit={submit}>
      {several && waiting && !onReviewPage && <p className="ask-progress">{words.ask.questionOf(page + 1, questions.length)}</p>}
      {several && waiting && onReviewPage && <p className="ask-progress">{words.ask.review}</p>}
      <h3>{several ? (waiting ? (onReviewPage ? words.ask.isThisRight : shownQuestion.question) : item.title) : item.question}</h3>
      {item.status === "answered" && item.answer && !several && !inRoom && (
        <div className="ask-answer">
          {words.ask.youChose} <strong>{item.answer.label}</strong>
          {item.answer.note && <> — “{item.answer.note}”</>}
          <span className="delivered">{deliveredNote(item.answer)}</span>
        </div>
      )}
      {item.status === "answered" && item.answer && several && !inRoom && <AnsweredSeveral answer={item.answer} count={questions.length} />}
      {item.status === "answered" && item.answer && inRoom && <div className="ask-answer">{t.rooms.vote.answered(item.answer.label)}</div>}
      {item.status === "cancelled" && <div className="ask-answer">{words.ask.withdrawn}</div>}
      {item.status === "waiting" && inRoom && <div className="ask-answer">{t.rooms.vote.voteInRoom}</div>}
      {pagesBeforeShown.map((before) => (
        <section key={before.id} className="ask-page-before" aria-label={words.ask.shownBeforeLabel(before.title)}>
          <div className="ask-page-before-title" data-hint={hints.askPageBefore}>
            {words.ask.shownJustBefore(before.title)}
          </div>
          <CanvasFrame frameId={`${item.id}-before-${before.id}`} html={before.html ?? ""} assetsOrigin={assetsOrigin} className="ask-context" panelFinds fitsContent followsTextSize />
        </section>
      ))}
      {onReviewPage && (
        <ol className="ask-review">
          {questions.map((question, index) => (
            <li key={index}>
              {question.question} <strong>{answers[index]?.label}</strong>
              {drafts[index]!.note.trim() && <> — “{drafts[index]!.note.trim()}”</>}{" "}
              <button type="button" className="link" onClick={() => setPage(index)}>
                {words.ask.change}
              </button>
            </li>
          ))}
        </ol>
      )}
      {!onReviewPage && (!several || waiting) && (
        <AskQuestionFields
          key={questionIndex}
          question={shownQuestion}
          draft={drafts[questionIndex]!}
          onChange={(change) => changeDraft(questionIndex, change)}
          waiting={waiting}
          answer={answerTo(item, questionIndex)}
          idPrefix={several ? `${item.id}-${questionIndex}` : item.id}
          radioName={several ? `ask-${item.id}-${questionIndex}` : `ask-${item.id}`}
          assetsOrigin={assetsOrigin}
        />
      )}
      {several &&
        !waiting &&
        questions.map((question, index) => {
          const answer = answerTo(item, index);
          return (
            <section key={index} className="ask-question">
              <p className="ask-progress">{words.ask.questionOf(index + 1, questions.length)}</p>
              <h4>{question.question}</h4>
              <AskQuestionFields
                question={question}
                draft={drafts[index]!}
                onChange={(change) => changeDraft(index, change)}
                waiting={false}
                answer={answer}
                idPrefix={`${item.id}-${index}`}
                radioName={`ask-${item.id}-${index}`}
                assetsOrigin={assetsOrigin}
              />
              {answer?.note && <div className="ask-question-note">{words.ask.yourNote(answer.note)}</div>}
            </section>
          );
        })}
      {waiting && !several && (
        <div className="ask-submit">
          <span className="ask-selection">{answerSoFar}</span>
          <button type="submit" className="primary" disabled={!currentAnswer}>
            {words.ask.submit}
          </button>
        </div>
      )}
      {onReviewPage && (
        <div className="ask-extras">
          <textarea
            {...typingAidAttributes}
            aria-label={words.ask.noteOnAll}
            value={note}
            placeholder={words.ask.noteOnAllPlaceholder}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={answerOnEnter}
          />
        </div>
      )}
      {waiting && several && (
        <div className="ask-submit">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {words.ask.back}
          </button>
          <span className="ask-selection">{onReviewPage ? "" : answerSoFar}</span>
          {onReviewPage ? (
            <button key="submit" type="submit" className="primary" disabled={!answers.every(isGiven)}>
              {words.ask.submit}
            </button>
          ) : (
            <button key="next" type="button" className="primary" disabled={!currentAnswer} onClick={() => setPage(page + 1)}>
              {words.ask.next}
            </button>
          )}
        </div>
      )}
    </form>
  );
}

const kindIcons: Record<Exclude<CanvasItem["kind"], "plugin">, string> = { show: "▣", ask: "?" };

/** The tab's header with only the agent's plan in it. */
const PLAN_ICON = "☑";

const iconOf = (item: CanvasItem) => (item.kind === "plugin" ? item.icon : kindIcons[item.kind]);

function outcomeOf(item: CanvasItem) {
  if (item.kind === "plugin" && item.outcome) return item.outcome;
  if (item.status === "waiting") return words.outcome.needsYourAnswer;
  if (item.status === "cancelled") return words.outcome.withdrawn;
  if (item.kind === "ask" && item.status === "answered" && item.answer) return `→ ${item.answer.label}`;
  return "";
}

/** What a plugin says came of its item, such as a review's verdict, in the agent's or the plugin's own words. */
const isVerdict = (item: CanvasItem) => item.kind === "plugin" && Boolean(item.outcome);

const outcomeIsFreeText = (item: CanvasItem) => isVerdict(item) || item.status === "answered";

/** Once a question is answered or withdrawn, it has had its turn on the canvas. */
const isSettledQuestion = (item: CanvasItem): item is AskItem => item.kind === "ask" && item.status !== "waiting";

function settledMessage(item: AskItem): SettledNote {
  return item.status === "answered" ? { text: words.ask.answerSent(item.answer?.label ?? ""), tone: "done" } : { text: words.ask.agentWithdrew, tone: "neutral" };
}

/** A note that goes away by itself a few seconds after it is set. */
function useFadingNote() {
  const [note, setNote] = useState<SettledNote | null>(null);
  useEffect(() => {
    if (note === null) return;
    const timer = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(timer);
  }, [note]);
  return [note, setNote] as const;
}

/** Clears the canvas when the question on it gets settled, leaving a short note of what happened. */
function useClearWhenSettled(selected: CanvasItem | undefined, clear: (settledId: string) => void) {
  const [note, setNote] = useFadingNote();
  const previous = useRef<{ id: string; status: CanvasItem["status"] } | null>(null);
  useEffect(() => {
    const wasWaiting = previous.current?.id === selected?.id && previous.current?.status === "waiting";
    previous.current = selected ? { id: selected.id, status: selected.status } : null;
    if (selected && wasWaiting && isSettledQuestion(selected)) {
      setNote(settledMessage(selected));
      clear(selected.id);
    }
  }, [selected?.id, selected?.status]);
  return note;
}

/**
 * The oldest edit the agent waits for permission to make takes the canvas, unless the user set the edits aside to look
 * at something else; a new one takes it back. Once the edit on the canvas is answered, the canvas clears and notes the answer.
 */
function useEditsOnCanvas(edits: EditRequest[], clear: () => void) {
  const waiting = edits.filter((edit) => !edit.resolved);
  const [setAside, setSetAside] = useState(false);
  const [note, setNote] = useFadingNote();
  const shown = setAside ? undefined : waiting[0];
  const previouslyShown = useRef<string | null>(null);
  const oldestWaiting = waiting[0]?.permissionId;
  useEffect(() => {
    if (oldestWaiting) setSetAside(false);
  }, [oldestWaiting]);
  useEffect(() => {
    const before = previouslyShown.current;
    previouslyShown.current = shown?.permissionId ?? null;
    const answered = before === shown?.permissionId ? undefined : edits.find((edit) => edit.permissionId === before && edit.resolved);
    if (!answered) return;
    setNote(settledEditNote(answered));
    clear();
  }, [shown?.permissionId, edits]);
  return { shown, waiting: waiting.length, note, setAside: () => setSetAside(true), bringBack: () => setSetAside(false) };
}

function CanvasHistory({ items, selectedId, onPick }: { items: CanvasItem[]; selectedId: string | null; onPick: (id: string) => void }) {
  return (
    <ul className="canvas-history" aria-label={words.bar.history}>
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" className={`history-entry ${item.id === selectedId ? "selected" : ""} status-${item.status}`} onClick={() => onPick(item.id)}>
            <time className="timestamp" title={formatFullTime(item.createdAt)}>
              {formatClockTime(item.createdAt)}
            </time>
            <span className="entry-kind">{iconOf(item)}</span>
            <span className="entry-title">{item.title}</span>
            <span className="entry-outcome">{outcomeOf(item)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Opens a review full screen or beside the chat, as its plugin's setting says; moving on from it gives back the layout it took. */
function useReviewPlacement() {
  const fullscreen = usePaneFullscreen("canvas");
  const tookFullscreen = useRef(false);
  return (item: CanvasItem | undefined) => {
    if (!fullscreen) return;
    if (item && opensWithRoom(item)) {
      const wanted = roomOf(item) === "fullscreen";
      fullscreen.setFullscreen(wanted);
      tookFullscreen.current = wanted;
    } else if (tookFullscreen.current) {
      fullscreen.setFullscreen(false);
      tookFullscreen.current = false;
    }
  };
}

/** How much of the bar folds into its More menu as it narrows: Point and ask first, then the arrows and the tabs beside the page's. */
const FOLDS = { none: 0, pageTools: 1, tabs: 2 };
const FOLD_LEVELS = Object.values(FOLDS);
const SMALLEST_TITLE_REM = 4;

/** Too full: the buttons run past the bar's end, or leave the title less room than it needs, down to a few letters. */
function crowded(bar: HTMLElement) {
  const title = bar.querySelector<HTMLElement>(".canvas-title");
  const smallestTitle = SMALLEST_TITLE_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);
  return bar.scrollWidth > bar.clientWidth || (title !== null && title.clientWidth < Math.min(smallestTitle, title.scrollWidth));
}

/**
 * Folds as few of the bar's buttons into its More menu as it takes for the rest to fit. Each level is tried on the bar
 * itself, so whatever it holds and however large the font, the measure is of what shows.
 */
function useFoldLevel(bar: RefObject<HTMLElement | null>) {
  const [level, setLevel] = useState(FOLDS.none);
  const measuredFor = useRef("");
  const fit = () => {
    const element = bar.current;
    if (!element) return;
    const fitting = FOLD_LEVELS.find((candidate) => {
      element.dataset.fold = String(candidate);
      return !crowded(element);
    });
    const chosen = fitting ?? FOLDS.tabs;
    element.dataset.fold = String(chosen);
    setLevel(chosen);
  };
  // Only on a change of what the bar says: measuring makes the browser lay the page out, and the pane re-renders often.
  // The bar's own resizing is the observer's to follow.
  useLayoutEffect(() => {
    const contents = bar.current?.textContent ?? "";
    if (contents === measuredFor.current) return;
    measuredFor.current = contents;
    fit();
  });
  useEffect(() => {
    const observer = new ResizeObserver(fit);
    observer.observe(bar.current!);
    return () => observer.disconnect();
  }, []);
  return level;
}

function ShownWorkspaceTab({ tab, viewPath, ...where }: { tab: WorkspacePluginTab; viewPath: string | undefined; assetsOrigin: string; workspaceId: string; conversationId: string }) {
  if (tab.problem) return <div className="empty-state plugin-tab-problem">{tab.problem}</div>;
  if (!viewPath) return <div className="empty-state plugin-tab-problem">{t.canvas.workspaceTabNoView(tab.plugin)}</div>;
  return <WorkspaceTabView key={`${tab.plugin} ${viewPath}`} tab={tab} viewUrl={`${where.assetsOrigin}${viewPath}`} {...where} />;
}

/** A tab that covers the canvas until it is closed; an app's is named after the app. */
type AppTab = `app:${string}`;
/** A plugin's tab in the workspace, named after the plugin. */
type PluginTab = `tab:${string}`;
type CoveringTab = "changes" | "checklist" | AppTab | PluginTab | null;

const appTab = (app: string): AppTab => `app:${app}`;
const pluginTab = (plugin: string): PluginTab => `tab:${plugin}`;

/** The apps open in the conversation's workspace, with what the panel needs to show them. */
export interface WorkspaceApps {
  /** Those this conversation has open, each with its tab: one document per app. */
  open: OpenApp[];
  /** The documents only other conversations of the workspace have open, which the user can open here too. */
  elsewhere: OpenApp[];
  installed: InstalledApp[];
  documents: Record<string, AppDocumentState>;
}

const openedDocument = ({ app, file }: OpenApp) => `${app}:${file}`;

/** A document, and the latest time this conversation's agent opened it or ran one of its tasks, if it did: either shows its tab again. */
const openingsHere = (app: OpenApp) => (app.shownAt === undefined ? [openedDocument(app)] : [openedDocument(app), `${openedDocument(app)}@${app.shownAt}`]);

/** The app documents each conversation's canvas last saw open, kept while the panel is made again for another conversation. */
const seenOpenApps = new Map<string, Set<string>>();

/**
 * Opens an app's tab when this conversation opens the app, opens another file, or its agent opens it again or runs one of
 * its tasks, as app_open and app_run say the user will see it, but not for a file the user picked in the app's view: at
 * once while the panel is up, or when the user comes back to the conversation, its canvas kept hidden or made again. A
 * question the agent waits on stays in front: an app opened meanwhile comes forward once it's answered.
 */
function useAppTabOnOpen(conversationId: string, open: OpenApp[], showTab: (tab: AppTab) => void, shown: boolean, questionWaiting: boolean) {
  const openNow = open.flatMap(openingsHere);
  useEffect(() => {
    if (!shown || questionWaiting) return;
    const seen = seenOpenApps.get(conversationId) ?? new Set(openNow);
    const opened = open.find((app) => !app.openedInView && openingsHere(app).some((opening) => !seen.has(opening)));
    seenOpenApps.set(conversationId, new Set(openNow));
    if (opened) showTab(appTab(opened.app));
  }, [conversationId, openNow.join("\n"), shown, questionWaiting]);
}

/** What each conversation's canvas showed when the user left it, which the panel, made again for each conversation, picks up. */
const leftViews = new Map<string, { latestId: string | undefined; selectedId: string | null; tab: CoveringTab; seenEdit: SeenEdit }>();
/** Each request to bring an item in front is met once, not again when the canvas mounts anew still holding it. */
const metItemRequests = new WeakSet<{ itemId: string }>();

/** The agent's change to the tab's item the user last saw, by item: its changes since flash once the tab opens. */
interface SeenEdit {
  tabItemId: string | undefined;
  at: number | undefined;
}

export function CanvasPanel({
  conversationId,
  items,
  plan,
  edits,
  assetsOrigin,
  homeDir,
  changesRefreshPoint,
  apps,
  workspaceTabs,
  workspaceId,
  canvasViews,
  onHide,
  inRoom = false,
  readOnly = false,
  itemToShow = null,
}: {
  conversationId: string;
  items: CanvasItem[];
  /** The plan the agent keeps for itself, pinned under its checklist. */
  plan: PlanEntry[] | null;
  /** The edits the agent asked permission for; none when Settings keep them in the chat. */
  edits: EditRequest[];
  assetsOrigin: string;
  homeDir: string;
  changesRefreshPoint: number;
  apps: WorkspaceApps;
  /** The plugins' tabs the conversation's workspace gets. */
  workspaceTabs: WorkspacePluginTab[];
  workspaceId: string | undefined;
  /** Where the canvas assets serve each canvas plugin's view, by plugin name. */
  canvasViews: Record<string, string>;
  onHide: () => void;
  /** A room's canvas, which holds its agents' pages and questions: no changes of a workspace, no pointing at a page to ask about it, and its questions are voted on in the room. */
  inRoom?: boolean;
  /** Seen by a person other than the machine's owner, who reads its pages and questions but neither saves nor reports on them. */
  readOnly?: boolean;
  /** The item the user asked to see, brought in front once for each time they ask. */
  itemToShow?: { itemId: string } | null;
}) {
  const pages = useMemo<CanvasItem[]>(() => items.filter((item) => !isTabItem(item)), [items]);
  const tabItem = currentTabItem(items);
  const newestFirst = useMemo(() => [...pages].sort((a, b) => b.createdAt - a.createdAt), [pages]);
  const newest = newestFirst[0];
  const onCanvasByDefault = newest && !isSettledQuestion(newest) ? newest.id : null;
  const checklistIsLatest = tabItem !== undefined && tabItem.createdAt > (newest?.createdAt ?? 0);
  const latestId = checklistIsLatest ? tabItem.id : newest?.id;
  const tabByDefault: CoveringTab = checklistIsLatest ? "checklist" : null;
  const left = leftViews.get(conversationId);
  const nothingNewSinceLeft = left?.latestId === latestId;
  const [selectedId, setSelectedId] = useState<string | null>(left && nothingNewSinceLeft ? left.selectedId : onCanvasByDefault);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tab, setTab] = useState<CoveringTab>(left && nothingNewSinceLeft ? left.tab : tabByDefault);
  const changesOpen = tab === "changes";
  const checklistOpen = tab === "checklist";
  const toggleTab = (toggled: Exclude<CoveringTab, null>) => setTab((open) => (open === toggled ? null : toggled));
  const shownApp = apps.open.find(({ app }) => tab === appTab(app));
  const shownAppInstalled = shownApp && apps.installed.find(({ name }) => name === shownApp.app);
  const shownPluginTab = workspaceTabs.find(({ plugin }) => tab === pluginTab(plugin));
  const editAt = tabItem?.agentEditedAt;
  const seenEdit = useRef<SeenEdit>(left ? left.seenEdit : { tabItemId: tabItem?.id, at: editAt });
  const checklistFlashing = useFlashOnAgentEdit(tabItem?.id, editAt, !checklistOpen);
  const placeForReview = useReviewPlacement();
  const keptSinceLeft = useRef(nothingNewSinceLeft);
  const shown = useContext(CanvasShown);
  useEffect(() => {
    if (!keptSinceLeft.current) {
      setSelectedId(onCanvasByDefault);
      setTab(tabByDefault);
    }
    keptSinceLeft.current = false;
  }, [latestId]);
  useEffect(() => {
    if (shown && takeArrivedReview(newest)) placeForReview(newest);
  }, [latestId, shown]);
  // After the reset to the newest item, so that an app the agent opened while the user was away stays in front.
  useAppTabOnOpen(conversationId, apps.open, setTab, shown, newest?.kind === "ask" && !isSettledQuestion(newest));
  useEffect(() => {
    if (checklistOpen || seenEdit.current.tabItemId !== tabItem?.id) seenEdit.current = { tabItemId: tabItem?.id, at: editAt };
  }, [checklistOpen, tabItem?.id, editAt]);
  useEffect(() => {
    leftViews.set(conversationId, { latestId, selectedId, tab, seenEdit: seenEdit.current });
  }, [conversationId, latestId, selectedId, tab, tabItem?.id, editAt]);
  const edit = useEditsOnCanvas(edits, () => setSelectedId(null));
  useEffect(() => {
    if (edit.shown) setTab(null);
  }, [edit.shown?.permissionId]);
  const selectedIndex = edit.shown ? -1 : newestFirst.findIndex(({ id }) => id === selectedId);
  const selected = newestFirst[selectedIndex];
  const shownPageFrame = useRef<HTMLIFrameElement>(null);
  const shownQuestionForm = useRef<HTMLFormElement>(null);
  const somethingElseShown = Boolean(selected || edit.shown);
  const nothingCovers = changesOpen || (!tab && !somethingElseShown);
  const changesShown = !inRoom && nothingCovers;
  const outcome = selected && outcomeOf(selected);
  const questionNote = useClearWhenSettled(selected, (settledId) => setSelectedId((current) => (current === settledId ? null : current)));
  const settledNote = edit.note ?? questionNote;
  const older = selected ? newestFirst[selectedIndex + 1] : newest;
  const newer = selected ? newestFirst[selectedIndex - 1] : undefined;
  const pick = (id: string) => {
    setSelectedId(id);
    setHistoryOpen(false);
    setTab(null);
    edit.setAside();
    placeForReview(pages.find((item) => item.id === id));
  };
  useEffect(() => {
    if (!itemToShow || metItemRequests.has(itemToShow)) return;
    metItemRequests.add(itemToShow);
    pick(itemToShow.itemId);
  }, [itemToShow]);
  const clear = () => {
    setSelectedId(null);
    setTab(null);
    edit.setAside();
    placeForReview(undefined);
  };
  const dismissChecklist = () => {
    setTab(null);
    if (tabItem) connection.send({ type: "canvas.dismiss", itemId: tabItem.id });
  };
  const toggleHistory = () => setHistoryOpen((open) => !open);
  const shownPluginItem = checklistOpen ? tabItem : !tab && selected?.kind === "plugin" ? selected : undefined;
  const poppable = canOpenItemWindows() ? shownPluginItem : undefined;
  const popOut = () => poppable && openItemWindow({ conversationId, itemId: poppable.id }, poppable.title);
  const shownPage = !tab && selected?.kind === "show" ? selected : undefined;
  const pageExport = usePageExport(shownPage, shownPageFrame);
  const pageMarks = usePageMarks(inRoom ? undefined : shownPage, shownPageFrame);
  const shownQuestion = !tab && selected?.kind === "ask" ? selected : undefined;
  const findTarget: FindTarget | undefined = shownPage
    ? { kind: "page", id: shownPage.id, frame: shownPageFrame }
    : shownQuestion && { kind: "question", id: shownQuestion.id, question: shownQuestionForm };
  const pageFind = usePageFind(findTarget);
  const receiveShownPageMessage = (message: CanvasFrameMessage) => {
    pageMarks.received(message);
    pageFind.received(message);
  };
  const bar = useRef<HTMLDivElement>(null);
  const foldLevel = useFoldLevel(bar);
  const checklistCountText = (tabItem || plan) && words.bar.checklist(String(tabCount(tabItem, plan)));
  const pageInFront = !tab && somethingElseShown;
  const underTabs = edit.shown
    ? { kind: "✎", title: edit.shown.title, empty: false }
    : selected
      ? { kind: iconOf(selected), title: selected.title, empty: false }
      : { kind: undefined, title: words.bar.canvas, empty: true };
  const tabsFolded = foldLevel >= FOLDS.tabs;
  const pageToolsFolded = foldLevel >= FOLDS.pageTools;
  const firstAfterSeparator = (entries: BarMenuEntry[]) => entries.map((entry, index) => (index === 0 ? { ...entry, separatorBefore: true } : entry));
  const foldedTabs: BarMenuEntry[] = tabsFolded
    ? [
        ...(inRoom ? [] : [{ label: words.bar.changes, checked: changesShown, disabled: !somethingElseShown && !checklistOpen, onChoose: () => toggleTab("changes") }]),
        ...(checklistCountText ? [{ label: checklistCountText, checked: checklistOpen, onChoose: () => toggleTab("checklist") }] : []),
        ...apps.open.map(({ app, title }) => ({ label: title, checked: tab === appTab(app), onChoose: () => toggleTab(appTab(app)) })),
        ...workspaceTabs.map(({ plugin, title }) => ({ label: title, checked: tab === pluginTab(plugin), onChoose: () => toggleTab(pluginTab(plugin)) })),
        ...(checklistOpen && tabItem ? [{ label: words.bar.dismiss, onChoose: dismissChecklist }] : []),
      ]
    : [];
  const foldedPageTools: BarMenuEntry[] = pageToolsFolded
    ? [
        ...(shownPage && !inRoom ? [{ label: words.bar.pointAndAsk, checked: pageMarks.pointing, onChoose: () => pageMarks.point(!pageMarks.pointing) }] : []),
        ...(pageMarks.waiting > 0 ? [{ label: words.markBatch.bar(pageMarks.waiting), checked: pageMarks.listOpen, onChoose: pageMarks.toggleList }] : []),
      ]
    : [];
  const pageActions: BarMenuEntry[] = [
    ...(findTarget ? [{ label: words.bar.findOnPage, shortcut: shortcutKeys().find, onChoose: pageFind.openFind }] : []),
    ...(readOnly ? [] : pageExport.entries),
    ...(poppable ? [{ label: words.bar.openInWindow, onChoose: popOut }] : []),
  ];
  const moreEntries: BarMenuEntry[] = [
    ...foldedTabs,
    ...firstAfterSeparator(foldedPageTools),
    ...firstAfterSeparator(pageActions),
    ...firstAfterSeparator([
      ...(tabsFolded
        ? [
            { label: words.bar.older, disabled: !older, onChoose: () => older && pick(older.id) },
            { label: words.bar.newer, disabled: !newer, onChoose: () => newer && pick(newer.id) },
          ]
        : []),
      { label: words.bar.clear, disabled: !somethingElseShown && !checklistOpen, onChoose: clear },
    ]),
    ...apps.elsewhere.map(({ workspaceId, app, documentId, title, file }, index) => ({
      label: words.bar.showApp(title, file),
      separatorBefore: index === 0,
      onChoose: () => connection.send({ type: "app.use-in", workspaceId, app, documentId, conversationId }),
    })),
  ];
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    if (historyOpen) setHistoryOpen(false);
    else if (pageMarks.listOpen) pageMarks.toggleList();
    else if (pageMarks.pointing) pageMarks.point(false);
    else return;
    event.preventDefault();
  };

  const panel = useRef<HTMLElement>(null);
  useOwnMouseSteps(panel, (step) => {
    const page = step === "back" ? older : newer;
    if (page) pick(page.id);
  });
  useFindOnPageRequests(panel, pageFind.openFind);

  return (
    <aside className="canvas-panel" ref={panel} onKeyDown={closeOnEscape} data-findable={findTarget ? "" : undefined}>
      <div className="canvas-header" data-pane-bar ref={bar} data-fold={foldLevel}>
        <PaneGrip pane="canvas" />
        <button type="button" className="icon canvas-nav" aria-label={words.bar.older} data-hint={hints.canvasOlder} disabled={!older} onClick={() => older && pick(older.id)}>
          ‹
        </button>
        <button type="button" className="icon canvas-nav" aria-label={words.bar.newer} data-hint={hints.canvasNewer} disabled={!newer} onClick={() => newer && pick(newer.id)}>
          ›
        </button>
        <button
          type="button"
          className={`page-tab history-toggle ${pageInFront ? "on" : ""}`}
          aria-pressed={pageInFront}
          aria-expanded={historyOpen}
          aria-label={`${underTabs.title} · ${words.bar.historyCount(pages.length)}`}
          data-hint={tab ? hints.canvasPageTab : hints.canvasHistory}
          disabled={!tab && pages.length === 0}
          data-bar-title
          onClick={({ detail: clicksInARow }) => (clicksInARow > 1 ? setHistoryOpen(false) : tab ? setTab(null) : toggleHistory())}
        >
          {underTabs.kind && <span className="canvas-kind">{underTabs.kind}</span>}
          <span className={tab ? "page-tab-title" : underTabs.empty ? "canvas-title empty-title" : "canvas-title"}>{underTabs.title}</span>
          {pages.length > 0 && (
            <span className="page-tab-history" aria-hidden="true">
              ▾
            </span>
          )}
        </button>
        {!tab && edit.shown && <span className="canvas-outcome status-waiting">{words.outcome.needsYourAnswer}</span>}
        {!tab && !edit.shown && selected && outcome && (
          <span className={`canvas-outcome status-${selected.status}${outcomeIsFreeText(selected) ? " free-text" : ""}`} title={outcome}>
            {outcome}
          </span>
        )}
        {(tab || !edit.shown) && edit.waiting > 0 && (
          <button
            type="button"
            className="canvas-outcome status-waiting edits-waiting"
            data-hint={hints.canvasEditsWaiting}
            onClick={() => {
              setTab(null);
              edit.bringBack();
            }}
          >
            {words.bar.editsWaiting(edit.waiting)}
          </button>
        )}
        {!inRoom && (
          <button
            type="button"
            className={`changes-toggle ${changesShown ? "on" : ""}`}
            aria-pressed={changesShown}
            data-hint={hints.canvasChanges}
            disabled={!somethingElseShown && !checklistOpen}
            onClick={() => toggleTab("changes")}
          >
            <span className={changesOpen ? "canvas-title" : undefined}>{words.bar.changes}</span>
          </button>
        )}
        {(tabItem || plan) && (
          <button
            type="button"
            className={["checklist-toggle", checklistOpen && "on", checklistFlashing && "agent-edited"].filter(Boolean).join(" ")}
            aria-pressed={checklistOpen}
            data-hint={hints.canvasChecklist}
            onClick={() => toggleTab("checklist")}
          >
            {checklistCountText}
          </button>
        )}
        {checklistOpen && (
          <>
            <span className="canvas-kind">{tabItem?.icon ?? PLAN_ICON}</span>
            <span className="canvas-title">{tabItem?.title ?? words.bar.agentsPlan}</span>
          </>
        )}
        {checklistOpen && tabItem && (
          <button type="button" className="icon checklist-dismiss" aria-label={words.bar.dismissChecklist} data-hint={hints.checklistDismiss} onClick={dismissChecklist}>
            {words.bar.dismiss}
          </button>
        )}
        {apps.open.map(({ app, title, file }) => {
          const shown = tab === appTab(app);
          return (
            <Fragment key={app}>
              <button type="button" className={`app-toggle ${shown ? "on" : ""}`} aria-pressed={shown} data-hint={hints.canvasApp} onClick={() => toggleTab(appTab(app))}>
                <span className={shown ? "canvas-title" : undefined}>{title}</span>
              </button>
              {shown && <span className="canvas-outcome app-file">{file}</span>}
            </Fragment>
          );
        })}
        {workspaceTabs.map(({ plugin, title }) => {
          const shown = tab === pluginTab(plugin);
          return (
            <button
              key={plugin}
              type="button"
              className={`app-toggle workspace-tab-toggle ${shown ? "on" : ""}`}
              aria-pressed={shown}
              data-hint={hints.canvasWorkspaceTab}
              onClick={() => toggleTab(pluginTab(plugin))}
            >
              <span className={shown ? "canvas-title" : undefined}>{title}</span>
            </button>
          );
        })}
        <span className="spacer" />
        {pageMarks.waiting > 0 && (
          <button
            type="button"
            className={`icon mark-batch-toggle ${pageMarks.listOpen ? "on" : ""}`}
            aria-pressed={pageMarks.listOpen}
            aria-label={words.markBatch.listLabel(pageMarks.waiting)}
            data-hint={hints.canvasMarkBatch}
            onClick={pageMarks.toggleList}
          >
            <MarkBatchIcon />
            <sup className="mark-batch-count">{pageMarks.waiting}</sup>
          </button>
        )}
        {shownPage && !inRoom && (
          <button
            type="button"
            className={`point-toggle ${pageMarks.pointing ? "on" : ""}`}
            aria-pressed={pageMarks.pointing}
            data-hint={hints.canvasPoint}
            onClick={() => pageMarks.point(!pageMarks.pointing)}
          >
            {words.bar.pointAndAsk}
          </button>
        )}
        <BarMenu
          className="canvas-more"
          label="⋯"
          buttonName={words.bar.more}
          menuName={words.bar.moreMenu}
          hint={hints.canvasMore}
          entries={moreEntries}
          flashing={foldLevel >= FOLDS.tabs && checklistFlashing}
        />
        <FullscreenToggle pane="canvas" />
        <button type="button" className="link canvas-hide" data-hint={hints.canvasHide} data-shortcut={shortcutKeys().toggleCanvas} onClick={onHide}>
          {words.bar.hide}
        </button>
      </div>
      {pageExport.opened}
      {pageFind.opened}
      {historyOpen && <CanvasHistory items={newestFirst} selectedId={selected?.id ?? null} onPick={pick} />}
      <div className="canvas-body">
        {nothingCovers && !somethingElseShown && (
          <div className="empty-state">
            <SettledNoteLine note={settledNote} />
            {pages.length === 0
              ? words.bar.emptyFirst
              : words.bar.empty}
          </div>
        )}
        {changesShown && <ChangesView conversationId={conversationId} refreshPoint={changesRefreshPoint} homeDir={homeDir} />}
        {checklistOpen && (
          <ChecklistView plan={plan}>
            {tabItem && (
              <PluginItemView key={tabItem.id} item={tabItem} viewPath={canvasViews[tabItem.plugin]} assetsOrigin={assetsOrigin} seenAgentEditAt={seenEdit.current.at ?? null} fitsContent />
            )}
          </ChecklistView>
        )}
        {shownApp && shownAppInstalled && (
          <AppView key={`${shownApp.app} ${shownAppInstalled.viewPath}`} openApp={shownApp} installed={shownAppInstalled} documentState={apps.documents[shownApp.documentId]} assetsOrigin={assetsOrigin} conversationId={conversationId} />
        )}
        {shownPluginTab && workspaceId && <ShownWorkspaceTab tab={shownPluginTab} viewPath={canvasViews[shownPluginTab.plugin]} assetsOrigin={assetsOrigin} workspaceId={workspaceId} conversationId={conversationId} />}
        {!tab && edit.shown && (
          <EditApproval key={edit.shown.permissionId} request={edit.shown} moreWaiting={edit.waiting - 1} note={settledNote} conversationId={conversationId} />
        )}
        {!tab && selected?.kind === "show" && (
          <CanvasFrame
            key={selected.id}
            frameId={selected.id}
            html={selected.html ?? ""}
            assetsOrigin={assetsOrigin}
            className="show"
            markable={!inRoom}
            panelFinds
            followsTextSize
            frameRef={shownPageFrame}
            onRendered={readOnly ? undefined : reportRender(selected.id)}
            onMessage={receiveShownPageMessage}
          />
        )}
        {pageMarks.opened}
        {!tab && selected?.kind === "plugin" && <PluginItemView key={selected.id} item={selected} viewPath={canvasViews[selected.plugin]} assetsOrigin={assetsOrigin} />}
        {shownQuestion && (
          <AskView
            key={shownQuestion.id}
            item={shownQuestion}
            pagesBefore={pages.filter((page): page is ShowItem => page.kind === "show" && shownQuestion.shownBefore?.includes(page.id) === true)}
            assetsOrigin={assetsOrigin}
            formRef={shownQuestionForm}
            answerable={!inRoom}
            inRoom={inRoom}
          />
        )}
      </div>
    </aside>
  );
}
