import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import type { PromptTemplate } from "../shared/model.ts";
import { filledIn, matchingTemplates, parametersOf, promptTemplateProblem } from "../shared/prompt-templates.ts";
import { ConfirmButton } from "./ConfirmButton.tsx";
import { connection } from "./connection.ts";
import { hints } from "./hints.ts";
import { t } from "./i18n/index.ts";
import { suggestionAttributes, usePickedSuggestion } from "./SuggestionList.tsx";
import { useTypingAidAttributes } from "./typing-aids.ts";

const NEW_TEMPLATE = "new";

const firstLineOf = (text: string) => text.split("\n").find((line) => line.trim()) ?? "";

/** The button that opens the popover toggles it itself, so a press on it is not a click outside. */
function useClosingOnOutsideClick(onClose: () => void, opener: RefObject<HTMLElement | null>) {
  const popover = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!popover.current?.contains(target) && !opener.current?.contains(target)) onClose();
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [onClose, opener]);
  return popover;
}

function TemplateForm({
  template,
  onSend,
  onInsert,
  onBack,
}: {
  template: PromptTemplate;
  onSend: (text: string) => void;
  onInsert: (text: string) => void;
  onBack: () => void;
}) {
  const parameters = parametersOf(template.text);
  const [values, setValues] = useState<Record<string, string>>({});
  const typingAidAttributes = useTypingAidAttributes();
  const text = filledIn(template.text, values);
  const complete = parameters.every((parameter) => values[parameter]?.trim());
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (complete) onSend(text);
  };
  return (
    <form className="template-form" onSubmit={send}>
      <div className="template-form-name">{template.name}</div>
      {parameters.map((parameter, index) => (
        <label key={parameter}>
          {parameter}
          <input
            {...typingAidAttributes}
            autoFocus={index === 0}
            value={values[parameter] ?? ""}
            onChange={(event) => setValues((current) => ({ ...current, [parameter]: event.target.value }))}
          />
        </label>
      ))}
      <div className="template-preview" aria-label={t.chat.templates.messageToSend}>
        {text}
      </div>
      <div className="template-actions">
        <button type="submit" className="primary" autoFocus={parameters.length === 0} disabled={!complete}>
          {t.chat.templates.send}
        </button>
        <button type="button" onClick={() => onInsert(text)}>
          {t.chat.templates.putInMessageBox}
        </button>
        <button type="button" className="link" onClick={onBack}>
          {t.chat.templates.back}
        </button>
      </div>
    </form>
  );
}

/**
 * The Templates button's popover: pick a template, fill in its parameters, then send it or put it in the message box.
 */
export function TemplatePicker({
  templates,
  opener,
  onSend,
  onInsert,
  onManage,
  onClose,
}: {
  templates: PromptTemplate[];
  opener: RefObject<HTMLElement | null>;
  onSend: (text: string) => void;
  onInsert: (text: string) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = templates.find(({ id }) => id === chosenId);
  const popover = useClosingOnOutsideClick(onClose, opener);
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <div ref={popover} className="template-picker" role="dialog" aria-label={t.chat.templates.label} onKeyDown={closeOnEscape}>
      {chosen ? (
        <TemplateForm template={chosen} onSend={onSend} onInsert={onInsert} onBack={() => setChosenId(null)} />
      ) : (
        <>
          {templates.length === 0 && <p className="hint">{t.chat.templates.noneYet}</p>}
          <ul className="template-choices">
            {templates.map((template, index) => (
              <li key={template.id}>
                <button type="button" autoFocus={index === 0} onClick={() => setChosenId(template.id)}>
                  <span className="template-choice-name">{template.name}</span>
                  <span className="template-choice-text">{firstLineOf(template.text)}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="link" onClick={onManage}>
            {t.chat.templates.manage}
          </button>
        </>
      )}
    </div>
  );
}

const FOUND_TEMPLATES_ID = "found-templates";

/** ⌘J's popover: typing narrows the templates, ↑/↓ pick one, Enter puts it in the message box, Esc goes back to it. */
export function TemplateFinder({
  templates,
  opener,
  onInsert,
  onClose,
}: {
  templates: PromptTemplate[];
  opener: RefObject<HTMLElement | null>;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const found = matchingTemplates(templates, query);
  const { pickedIndex, move } = usePickedSuggestion(found.length, query);
  const popover = useClosingOnOutsideClick(onClose, opener);
  const typingAidAttributes = useTypingAidAttributes();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const step = ({ ArrowDown: 1, ArrowUp: -1 } as const)[event.key as "ArrowDown" | "ArrowUp"];
    if (step && found.length > 0) move(step);
    else if (event.key === "Enter" && found[pickedIndex]) onInsert(found[pickedIndex].text);
    else if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    } else return;
    event.preventDefault();
  };
  return (
    <div ref={popover} className="template-picker template-finder" role="dialog" aria-label={t.chat.templates.findLabel}>
      <input
        {...typingAidAttributes}
        {...suggestionAttributes(FOUND_TEMPLATES_ID, found.length > 0, pickedIndex)}
        autoFocus
        role="combobox"
        aria-expanded={found.length > 0}
        aria-label={t.chat.templates.find}
        placeholder={t.chat.templates.find}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {found.length === 0 ? (
        <p className="hint">{templates.length === 0 ? t.chat.templates.noneYetSettingsAdds : t.chat.templates.noMatch}</p>
      ) : (
        <ul id={FOUND_TEMPLATES_ID} className="template-choices" role="listbox" aria-label={t.chat.templates.label}>
          {found.map((template, index) => (
            <li key={template.id} id={`${FOUND_TEMPLATES_ID}-${index}`} role="option" aria-selected={index === pickedIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => onInsert(template.text)}>
              <span className="template-choice-name">{template.name}</span>
              <span className="template-choice-text">{firstLineOf(template.text)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateEditor({ template, onCreated }: { template: PromptTemplate | undefined; onCreated: (templateId: string) => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [text, setText] = useState(template?.text ?? "");
  const typingAidAttributes = useTypingAidAttributes();
  const parameters = parametersOf(text);
  const unchanged = template !== undefined && name === template.name && text === template.text;
  const problem = name.trim() && text.trim() ? promptTemplateProblem({ id: template?.id ?? NEW_TEMPLATE, name, text }) : null;
  const save = (event: FormEvent) => {
    event.preventDefault();
    const templateId = template?.id ?? crypto.randomUUID();
    if (connection.send({ type: "prompt-template.save", template: { id: templateId, name, text } }) && !template) onCreated(templateId);
  };
  const remove = () => template && connection.send({ type: "prompt-template.delete", templateId: template.id });
  return (
    <form className="profile-editor" aria-label={template ? t.chat.templates.template(template.name) : t.chat.templates.newTemplate} onSubmit={save}>
      <label>
        <span>{t.chat.templates.name}</span>
        <input {...typingAidAttributes} aria-label={t.chat.templates.nameLabel} value={name} placeholder={t.chat.templates.namePlaceholder} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        <span>{t.chat.templates.text}</span>
        <textarea
          {...typingAidAttributes}
          aria-label={t.chat.templates.textLabel}
          rows={6}
          value={text}
          placeholder={t.chat.templates.textPlaceholder}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="hint">
        {parameters.length > 0 ? t.chat.templates.asksFor(parameters.join(", ")) : t.chat.templates.howToAsk}
      </div>
      {problem && <div className="form-errors">{problem}</div>}
      <div className="form-actions">
        <button type="submit" disabled={!name.trim() || !text.trim() || problem !== null || unchanged}>
          {template ? t.chat.templates.save : t.chat.templates.create}
        </button>
        {template && (
          <ConfirmButton className="danger" label={t.chat.templates.deleteLabel} armedText={t.chat.templates.deleteArmed} armedHint={hints.deleteTemplateArmed} onConfirm={remove}>
            {t.chat.templates.delete}
          </ConfirmButton>
        )}
      </div>
    </form>
  );
}

/** Settings' list of prompt templates, with an editor for the one picked or a new one. */
export function PromptTemplateSettings({ templates }: { templates: PromptTemplate[] }) {
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? NEW_TEMPLATE);
  const selected = templates.find(({ id }) => id === selectedId);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (createdId && templates.some(({ id }) => id === createdId)) {
      setSelectedId(createdId);
      setCreatedId(null);
    } else if (selectedId !== NEW_TEMPLATE && !selected) setSelectedId(templates[0]?.id ?? NEW_TEMPLATE);
  }, [createdId, selectedId, selected, templates]);

  return (
    <>
      <h3>{t.chat.templates.title}</h3>
      <p className="hint">
        {t.chat.templates.hintBefore} <code>{t.chat.templates.example}</code> {t.chat.templates.hintAfter}
      </p>
      <div className="profiles-body">
        <ul className="profile-list" aria-label={t.chat.templates.label}>
          {templates.map((template) => (
            <li key={template.id} className={template.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(template.id)}>
              {template.name}
            </li>
          ))}
          <li className={selectedId === NEW_TEMPLATE ? "selected" : ""} onClick={() => setSelectedId(NEW_TEMPLATE)}>
            {t.chat.templates.addNew}
          </li>
        </ul>
        <TemplateEditor key={selected?.id ?? NEW_TEMPLATE} template={selected} onCreated={setCreatedId} />
      </div>
    </>
  );
}
