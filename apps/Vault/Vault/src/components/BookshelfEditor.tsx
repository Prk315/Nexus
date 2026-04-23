import { useCallback, useEffect, useRef, useState } from "react";

// ── Data model ────────────────────────────────────────────────────────────────

interface ReadingLogEntry {
  id: string;
  date: string;       // "YYYY-MM-DD"
  pagesRead: number;
  chaptersRead: number;
  note: string;
}

interface BookItem {
  id: string;
  title: string;
  author: string;
  totalPages: number;
  totalChapters: number;
  currentPage: number;
  currentChapter: number;
  dailyPagesGoal: number;
  weeklyChaptersGoal: number;
  log: ReadingLogEntry[];
  collapsed: boolean;
}

interface BookshelfData {
  books: BookItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 10); }

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeekISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

function defaultData(): BookshelfData {
  return { books: [] };
}

function parseData(raw: string): BookshelfData {
  if (!raw) return defaultData();
  try {
    const d = JSON.parse(raw);
    return {
      books: Array.isArray(d.books) ? d.books.map((b: any): BookItem => ({
        id: b.id ?? uid(),
        title: b.title ?? "",
        author: b.author ?? "",
        totalPages: b.totalPages ?? 0,
        totalChapters: b.totalChapters ?? 0,
        currentPage: b.currentPage ?? 0,
        currentChapter: b.currentChapter ?? 0,
        dailyPagesGoal: b.dailyPagesGoal ?? 0,
        weeklyChaptersGoal: b.weeklyChaptersGoal ?? 0,
        log: Array.isArray(b.log) ? b.log : [],
        collapsed: b.collapsed ?? false,
      })) : [],
    };
  } catch { return defaultData(); }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GoalBar({ label, value, goal, unit }: { label: string; value: number; goal: number; unit: string }) {
  if (goal <= 0) return null;
  const pct = Math.min(100, Math.round((value / goal) * 100));
  const met = value >= goal;
  return (
    <div className="bk-goal-row">
      <span className="bk-goal-label">{label}</span>
      <div className="bk-goal-bar-track">
        <div className="bk-goal-bar-fill" style={{ width: `${pct}%`, background: met ? "#16a34a" : "#3b82f6" }} />
      </div>
      <span className="bk-goal-stat" style={{ color: met ? "#16a34a" : undefined }}>
        {value} / {goal} {unit}
      </span>
    </div>
  );
}

function BookCard({ item, onPatch, onDelete }: {
  item: BookItem;
  onPatch: (p: Partial<BookItem>) => void;
  onDelete: () => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [logPages, setLogPages] = useState("");
  const [logChapters, setLogChapters] = useState("");
  const [logNote, setLogNote] = useState("");

  const today = todayISO();
  const weekStart = startOfWeekISO();

  const todayPages    = item.log.filter(e => e.date === today).reduce((s, e) => s + e.pagesRead, 0);
  const weekChapters  = item.log.filter(e => e.date >= weekStart).reduce((s, e) => s + e.chaptersRead, 0);
  const pagesPct      = item.totalPages    > 0 ? Math.min(100, Math.round((item.currentPage    / item.totalPages)    * 100)) : 0;
  const chaptersPct   = item.totalChapters > 0 ? Math.min(100, Math.round((item.currentChapter / item.totalChapters) * 100)) : 0;

  function logSession() {
    const pages    = Math.max(0, parseInt(logPages)    || 0);
    const chapters = Math.max(0, parseFloat(logChapters) || 0);
    if (pages === 0 && chapters === 0) return;
    const entry: ReadingLogEntry = { id: uid(), date: today, pagesRead: pages, chaptersRead: chapters, note: logNote.trim() };
    onPatch({
      log: [...item.log, entry],
      currentPage:    Math.min(item.totalPages    || Infinity, item.currentPage    + pages),
      currentChapter: Math.min(item.totalChapters || Infinity, item.currentChapter + chapters),
    });
    setLogPages(""); setLogChapters(""); setLogNote("");
  }

  function removeLogEntry(id: string) {
    const removed = item.log.find(e => e.id === id);
    if (!removed) return;
    onPatch({
      log: item.log.filter(e => e.id !== id),
      currentPage:    Math.max(0, item.currentPage    - removed.pagesRead),
      currentChapter: Math.max(0, item.currentChapter - removed.chaptersRead),
    });
  }

  return (
    <div className="bk-card">
      <div className="bk-card-header">
        <button className="ex-collapse-btn" onClick={() => onPatch({ collapsed: !item.collapsed })}
          title={item.collapsed ? "Expand" : "Collapse"}>{item.collapsed ? "▸" : "▾"}</button>

        <div className="bk-title-group">
          <input className="bk-title-input" value={item.title} placeholder="Book title…"
            onChange={e => onPatch({ title: e.target.value })} />
          <input className="bk-author-input" value={item.author} placeholder="Author"
            onChange={e => onPatch({ author: e.target.value })} />
        </div>

        {item.totalPages    > 0 && <span className="bk-progress-pill">{pagesPct}% pages</span>}
        {item.totalChapters > 0 && <span className="bk-progress-pill">{chaptersPct}% ch.</span>}

        <button className="ex-delete-btn" onClick={onDelete} title="Delete book">×</button>
      </div>

      {!item.collapsed && (
        <div className="bk-card-body">
          <div className="bk-meta-row">
            <label className="bk-meta-label">Total pages
              <input className="bk-meta-input" type="number" min={0} value={item.totalPages || ""}
                placeholder="0" onChange={e => onPatch({ totalPages: parseInt(e.target.value) || 0 })} />
            </label>
            <label className="bk-meta-label">Total chapters
              <input className="bk-meta-input" type="number" min={0} value={item.totalChapters || ""}
                placeholder="0" onChange={e => onPatch({ totalChapters: parseInt(e.target.value) || 0 })} />
            </label>
            <label className="bk-meta-label">Daily pages goal
              <input className="bk-meta-input" type="number" min={0} value={item.dailyPagesGoal || ""}
                placeholder="0" onChange={e => onPatch({ dailyPagesGoal: parseInt(e.target.value) || 0 })} />
            </label>
            <label className="bk-meta-label">Weekly chapters goal
              <input className="bk-meta-input" type="number" min={0} value={item.weeklyChaptersGoal || ""}
                placeholder="0" onChange={e => onPatch({ weeklyChaptersGoal: parseInt(e.target.value) || 0 })} />
            </label>
          </div>

          {(item.totalPages > 0 || item.totalChapters > 0) && (
            <div className="bk-overall-progress">
              {item.totalPages    > 0 && <GoalBar label="Overall pages"    value={item.currentPage}    goal={item.totalPages}    unit="pages" />}
              {item.totalChapters > 0 && <GoalBar label="Overall chapters" value={item.currentChapter} goal={item.totalChapters} unit="ch."   />}
            </div>
          )}

          {(item.dailyPagesGoal > 0 || item.weeklyChaptersGoal > 0) && (
            <div className="bk-goals-section">
              <span className="bk-goals-heading">Today / this week</span>
              <GoalBar label="Today"     value={todayPages}   goal={item.dailyPagesGoal}     unit="pages" />
              <GoalBar label="This week" value={weekChapters} goal={item.weeklyChaptersGoal} unit="ch."   />
            </div>
          )}

          <div className="bk-log-section">
            <button className="wb-reveal-btn" onClick={() => setLogOpen(v => !v)}>
              {logOpen ? "▾ Hide log session" : "▸ Log reading session"}
            </button>
            {logOpen && (
              <div className="bk-log-form">
                <label className="bk-meta-label">Pages read
                  <input className="bk-meta-input" type="number" min={0} value={logPages}
                    placeholder="0" onChange={e => setLogPages(e.target.value)} />
                </label>
                <label className="bk-meta-label">Chapters read
                  <input className="bk-meta-input" type="number" min={0} step={0.5} value={logChapters}
                    placeholder="0" onChange={e => setLogChapters(e.target.value)} />
                </label>
                <label className="bk-meta-label bk-log-note-label">Note (optional)
                  <input className="bk-input-wide" value={logNote} placeholder="What did you read?"
                    onChange={e => setLogNote(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") logSession(); }} />
                </label>
                <button className="wb-add-btn" onClick={logSession}>Save session</button>
              </div>
            )}
          </div>

          {item.log.length > 0 && (
            <div className="bk-history">
              <span className="bk-goals-heading">History</span>
              {[...item.log].reverse().map(entry => (
                <div key={entry.id} className="bk-history-row">
                  <span className="bk-history-date">{entry.date}</span>
                  <span className="bk-history-stat">{entry.pagesRead}p</span>
                  <span className="bk-history-stat">{entry.chaptersRead}ch</span>
                  {entry.note && <span className="bk-history-note">{entry.note}</span>}
                  <button className="ex-block-remove" title="Remove entry" onClick={() => removeLogEntry(entry.id)}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

interface BookshelfEditorProps {
  nodeId: string;
  name: string;
  content: string;
  onChange: (content: string) => void;
}

export function BookshelfEditor({ nodeId, name, content, onChange }: BookshelfEditorProps) {
  const [data, setData] = useState<BookshelfData>(() => parseData(content));
  const prevNodeId = useRef(nodeId);

  useEffect(() => {
    if (prevNodeId.current !== nodeId) {
      prevNodeId.current = nodeId;
      setData(parseData(content));
    }
  }, [nodeId, content]);

  useEffect(() => {
    const t = setTimeout(() => onChange(JSON.stringify(data)), 400);
    return () => clearTimeout(t);
  }, [data]);

  const update = useCallback((patch: Partial<BookshelfData>) => {
    setData(prev => ({ ...prev, ...patch }));
  }, []);

  function addBook() {
    update({
      books: [...data.books, {
        id: uid(), title: "", author: "", totalPages: 0, totalChapters: 0,
        currentPage: 0, currentChapter: 0, dailyPagesGoal: 0, weeklyChaptersGoal: 0,
        log: [], collapsed: false,
      }],
    });
  }

  function delBook(id: string) {
    update({ books: data.books.filter(b => b.id !== id) });
  }

  function patchBook(id: string, p: Partial<BookItem>) {
    update({ books: data.books.map(b => b.id === id ? { ...b, ...p } : b) });
  }

  return (
    <div className="wb-root">
      <div className="wb-header">
        <span className="wb-title">{name}</span>
        <button className="wb-add-btn" style={{ marginLeft: "auto" }} onClick={addBook}>+ Add book</button>
      </div>
      <div className="wb-body">
        <div className="wb-section">
          {data.books.length === 0 && (
            <div className="wb-empty">No books yet — add a course book and set your daily &amp; weekly reading goals.</div>
          )}
          {data.books.map(book => (
            <BookCard
              key={book.id}
              item={book}
              onPatch={p => patchBook(book.id, p)}
              onDelete={() => delBook(book.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
