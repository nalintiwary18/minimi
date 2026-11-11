"use client";
import { ArrowUp, Square, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useChat } from "./use-chat";
import { Answer, SourceList, dateLabel } from "./message-content";
import { AgentProgress, AnswerSkeleton } from "./agent-progress";
import { MeshOrb } from "./mesh-orb";

const starters = [
  {
    label: "AI this week",
    text: "What changed in AI this week?",
    color: "coral",
  },
  {
    label: "Compare hosting",
    text: "Help me compare Postgres hosting",
    color: "mint",
  },
  {
    label: "Recall a question",
    text: "What did I ask you last Tuesday?",
    color: "lilac",
  },
];
export function ChatWorkspace() {
  const {
    sessions,
    sessionId,
    turns,
    question,
    setQuestion,
    busy,
    loading,
    status,
    error,
    sidebar,
    setSidebar,
    abort,
    end,
    input,
    selectSession,
    send,
    newConversation,
  } = useChat();
  return (
    <div className={`workspace ${sidebar ? "" : "sidebar-hidden"}`}>
      <aside className="sidebar" id="conversation-sidebar">
        <a className="brand" href="/" aria-label="Recall home">
          recall
          <span className="brand-dot" aria-hidden="true">
            .
          </span>
        </a>
        <button
          className="new-chat"
          disabled={busy || loading}
          onClick={newConversation}
        >
          New conversation
        </button>
        <div className="nav-label">Conversations</div>
        <nav aria-label="Conversations">
          {sessions.map((s) => (
            <button
              disabled={busy || loading}
              className={sessionId === s.id ? "active" : ""}
              key={s.id}
              onClick={() => selectSession(s.id)}
            >
              <span>{s.title}</span>
            </button>
          ))}
          {loading && !sessions.length && (
            <div
              className="history-skeleton"
              aria-label="Loading conversations"
            >
              <span />
              <span />
              <span />
            </div>
          )}
          {!loading && !sessions.length && (
            <p className="empty-history">Your conversations will live here.</p>
          )}
        </nav>
        <div className="sidebar-note">
          <p>Your conversations, remembered.</p>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">Y</span>
          <div>
            You<span>Personal workspace</span>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <button
              className="icon-button"
              onClick={() => setSidebar(!sidebar)}
              aria-label="Toggle sidebar"
              aria-expanded={sidebar}
              aria-controls="conversation-sidebar"
            >
              {sidebar ? (
                <PanelLeftClose size={18} />
              ) : (
                <PanelLeftOpen size={18} />
              )}
            </button>
            <span>Recall</span>
            <span className="header-separator">/</span>
            <small>{sessionId ? "Conversation" : "New conversation"}</small>
          </div>
        </header>
        <div className="conversation">
          {!turns.length ? (
            <section className="welcome">
              <MeshOrb />
              <h1>What’s on your mind?</h1>
              <div className="starter-grid">
                {starters.map((s) => (
                  <button
                    disabled={busy || loading}
                    key={s.label}
                    className={`starter-card ${s.color}`}
                    onClick={() => send(s.text)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="turns">
              {turns.map((t) => (
                <article className="turn" key={t.id}>
                  <div className="user-row">
                    <div className="user-bubble">{t.question}</div>
                  </div>
                  <div className="turn-date">{dateLabel(t.created_at)}</div>
                  <div className="assistant-row">
                    <div className="answer-content">
                      <div className="answer-name">Recall</div>
                      {t.answer ? (
                        <Answer text={t.answer} sources={t.sources} />
                      ) : t.status === "pending" ? (
                        <AnswerSkeleton />
                      ) : (
                        <p className="interrupted">
                          This response did not finish.
                        </p>
                      )}
                      <SourceList sources={t.sources} />
                      {t.status === "error" && t.answer && (
                        <p className="interrupted">
                          Partial answer · response interrupted
                        </p>
                      )}
                      {t.status === "error" && (
                        <button
                          className="retry-answer"
                          disabled={busy || loading}
                          onClick={() => send(t.question)}
                        >
                          Try again
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
              <div ref={end} />
            </div>
          )}
        </div>
        <div className="composer-area">
          {error && (
            <div role="alert" className="error-banner">
              {error}
            </div>
          )}
          <div
            className={`progress-slot ${busy ? "active" : ""}`}
            aria-hidden={!busy}
          >
            <div>{busy && <AgentProgress status={status} />}</div>
          </div>
          <form
            className="composer"
            aria-busy={busy}
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              ref={input}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything, or pick up a past conversation…"
              aria-label="Message"
              rows={2}
              maxLength={8000}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="composer-bottom">
              <span className="composer-hint">Enter to send</span>
              {busy ? (
                <button
                  type="button"
                  className="send-button"
                  aria-label="Stop response"
                  onClick={() => abort.current?.abort()}
                >
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="send-button"
                  disabled={!question.trim() || loading}
                  aria-label="Send message"
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </form>
          <div className="composer-caption">
            Answers can be imperfect. Check the sources for important decisions.
          </div>
        </div>
      </main>
    </div>
  );
}
