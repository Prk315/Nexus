import sys
import os
import json
import io
import base64
import tempfile
import traceback
import contextlib

namespace: dict = {}

# Inject display_html into the namespace so Python cells can emit HTML output
_html_outputs: list = []

def _display_html(html: str) -> None:
    _html_outputs.append(html)

namespace["display_html"] = _display_html

def _run(code: str) -> dict:
    chunks = []

    # Save the real stdout fd so we can restore it to write JSON later.
    # We redirect fd 1 to a temp file so subprocess calls (pip, etc.) are
    # captured instead of polluting the JSON protocol channel.
    real_stdout_fd = os.dup(1)
    fd_capture = tempfile.TemporaryFile()
    os.dup2(fd_capture.fileno(), 1)

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    try:
        # Intercept matplotlib show
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            def _show(*args, **kwargs):
                # Flush any pending print() output before the image
                text = stdout_buf.getvalue()
                if text:
                    chunks.append({"type": "text", "content": text})
                    stdout_buf.truncate(0)
                    stdout_buf.seek(0)
                buf = io.BytesIO()
                plt.savefig(buf, format="png", bbox_inches="tight", dpi=120)
                buf.seek(0)
                chunks.append({"type": "image", "content": base64.b64encode(buf.read()).decode()})
                plt.close()

            plt.show = _show
        except ImportError:
            pass

        with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
            try:
                exec(compile(code, "<cell>", "exec"), namespace)
            except Exception:
                stderr_buf.write(traceback.format_exc())

    finally:
        # Always restore real stdout before anything else
        os.dup2(real_stdout_fd, 1)
        os.close(real_stdout_fd)

    # Collect fd-level output (subprocess writes, pip, etc.)
    fd_capture.seek(0)
    fd_text = fd_capture.read().decode("utf-8", errors="replace")
    fd_capture.close()

    # Combine: fd output first (subprocess), then print() output
    combined_text = fd_text + stdout_buf.getvalue()
    if combined_text:
        chunks.append({"type": "text", "content": combined_text})

    # Collect any display_html() calls
    for html in _html_outputs:
        chunks.append({"type": "html", "content": html})
    _html_outputs.clear()

    err = stderr_buf.getvalue()
    if err:
        chunks.append({"type": "error", "content": err})

    return {"chunks": chunks}


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
        result = _run(msg.get("code", ""))
    except Exception as e:
        result = {"chunks": [{"type": "error", "content": traceback.format_exc()}]}
    print(json.dumps(result), flush=True)
