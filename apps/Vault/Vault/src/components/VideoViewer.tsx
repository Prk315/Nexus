import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  content: string;
}

export function VideoViewer({ content }: Props) {
  const src = convertFileSrc(content);
  if (!content) {
    return (
      <div className="video-empty">
        <p>No video loaded</p>
      </div>
    );
  }

  return (
    <div className="video-viewer">
      <video
        className="video-player"
        src={src}
        controls
        key={src}
      />
    </div>
  );
}
