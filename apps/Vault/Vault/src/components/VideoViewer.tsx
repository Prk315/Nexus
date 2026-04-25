interface Props {
  content: string; // Supabase Storage public URL for the video
}

export function VideoViewer({ content }: Props) {
  const src = content;
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
