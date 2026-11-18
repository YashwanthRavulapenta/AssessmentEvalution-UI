import type { ChangeEvent } from "react";
import { Camera, FileText, ImagePlus, UploadCloud, X } from "lucide-react";

interface Props {
  title: string;
  file: File | null;
  selectedLabel?: string;
  photoCount?: number;
  disabled?: boolean;
  onPdf: (file: File) => void;
  onImages: (files: FileList) => void;
  onRemove: () => void;
  kind: "master" | "student";
}

export function PdfUpload({
  title,
  file,
  selectedLabel,
  photoCount = 0,
  disabled = false,
  onPdf,
  onImages,
  onRemove,
  kind,
}: Props) {
  function handleImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    if (files?.length) onImages(files);
    event.currentTarget.value = "";
  }

  return (
    <section className={`upload-card ${kind}`}>
      <div className="upload-head">
        <div className="upload-icon">
          <FileText size={20} />
        </div>
        <h2>{title}</h2>
      </div>

      {file || selectedLabel ? (
        <div className="file-selected">
          <FileText size={19} />
          <div>
            <strong>{file?.name ?? selectedLabel}</strong>
            <span>
              {file
                ? photoCount > 0
                  ? `${photoCount} photo pages · PDF ready`
                  : `${(file.size / 1024 / 1024).toFixed(2)} MB · PDF ready`
                : "Saved answer key · ready to reuse"}
            </span>
          </div>
          <button
            className="icon-btn"
            onClick={onRemove}
            aria-label={`Remove ${title.toLowerCase()}`}
            disabled={disabled}
          >
            <X size={17} />
          </button>
        </div>
      ) : (
        <div className="drop-area">
          <UploadCloud size={24} />
          <span>Choose a PDF</span>
          <label className="file-picker">
            Browse files
            <input
              className="file-input"
              type="file"
              accept="application/pdf,.pdf"
              disabled={disabled}
              onChange={(event) => {
                const selectedFile = event.currentTarget.files?.[0];
                if (selectedFile) onPdf(selectedFile);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      )}

      {kind === "student" && (
        <div className="photo-actions">
          <label className="photo-btn">
            <Camera size={16} />
            Capture pages
            <input
              className="file-input"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              disabled={disabled}
              onChange={handleImageSelection}
            />
          </label>
          <label className="photo-btn">
            <ImagePlus size={16} />
            Upload photos
            <input
              className="file-input"
              type="file"
              accept="image/*"
              multiple
              disabled={disabled}
              onChange={handleImageSelection}
            />
          </label>
        </div>
      )}
    </section>
  );
}
