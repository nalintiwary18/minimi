const stages = ["Context", "Evidence", "Answer"];

export function AgentProgress({ status }: { status: string }) {
  const stage = /writing/i.test(status) ? 2 : /searching/i.test(status) ? 1 : 0;
  return (
    <div className="agent-progress" role="status" aria-live="polite">
      <div className="progress-heading">
        <span>{status || "Getting ready"}</span>
        <span className="progress-label">In progress</span>
      </div>
      <div className="progress-stages" aria-hidden="true">
        {stages.map((label, index) => (
          <div
            key={label}
            className={`progress-stage ${index < stage ? "complete" : index === stage ? "current" : ""}`}
          >
            <span className="progress-track">
              <span />
            </span>
            <span className="stage-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnswerSkeleton() {
  return (
    <div className="answer-skeleton" aria-label="Preparing an answer">
      <span />
      <span />
      <span />
    </div>
  );
}
