interface Props {
  preparingPhotos?: boolean;
  stage?: string;
}

export function LoadingSteps({
  preparingPhotos = false,
  stage = "Waiting for an evaluation worker",
}: Props) {

  return (
    <div className="evaluation-overlay" role="status" aria-live="polite">
      <div className="evaluation-loader">
        <div className="loader-orbit" aria-hidden="true">
          <div className="loader-orbit-core" />
        </div>
        <h2>
          {preparingPhotos
            ? "Preparing your photos"
            : "Evaluating your answer sheet"}
        </h2>
        <div
          className="loader-stage"
          key={preparingPhotos ? "photos" : stage}
        >
          <strong>
            {preparingPhotos ? "Converting your photos" : stage}
          </strong>
          {preparingPhotos && (
            <span>Combining selected pages into a student answer sheet.</span>
          )}
        </div>
        <div className="loader-shimmer" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
