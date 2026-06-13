// Reference implementation for the CenterStage `browser` slot (Phase 2).
// REFERENCE for the second LLM: drop into src/ui and render when stage === 'browser'.
// It connects to the agent-browser viewport stream, renders live frames, and
// supports an optional "take over" mode that forwards mouse and keyboard input.
// The frame and input message shapes below were confirmed against a live stream.
import { useEffect, useRef, useState } from 'react';

type Props = {
  // e.g. wss://hive-browser.example.com/api/session/65025/stream
  streamUrl: string;
};

type FrameMeta = { deviceWidth: number; deviceHeight: number };

export function BrowserStage({ streamUrl }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const metaRef = useRef<FrameMeta>({ deviceWidth: 1280, deviceHeight: 720 });
  const [connected, setConnected] = useState(false);
  const [takeover, setTakeover] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(streamUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      // The stream auto-pushes frames; these are harmless if ignored.
      for (const t of ['start_screencast', 'startScreencast', 'screencast', 'start']) {
        try { ws.send(JSON.stringify({ type: t })); } catch (e) { void e; }
      }
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg: { type?: string; data?: string; metadata?: FrameMeta };
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'frame' && msg.data && imgRef.current) {
        imgRef.current.src = `data:image/jpeg;base64,${msg.data}`;
        if (msg.metadata) metaRef.current = msg.metadata;
      }
    };
    ws.onclose = () => setConnected(false);
    return () => ws.close();
  }, [streamUrl]);

  const toViewport = (e: React.MouseEvent) => {
    const el = imgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const { deviceWidth, deviceHeight } = metaRef.current;
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * deviceWidth),
      y: Math.round(((e.clientY - r.top) / r.height) * deviceHeight),
    };
  };
  const sendMouse = (eventType: string, e: React.MouseEvent) => {
    if (!takeover || !wsRef.current) return;
    const { x, y } = toViewport(e);
    wsRef.current.send(JSON.stringify({ type: 'input_mouse', eventType, x, y, button: 'left', clickCount: 1 }));
  };
  const sendKey = (eventType: string, e: React.KeyboardEvent) => {
    if (!takeover || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'input_keyboard', eventType, key: e.key, code: e.code }));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 py-2 text-xs">
        <span className={connected ? 'text-success' : 'text-muted-foreground'}>
          {connected ? 'live browser connected' : 'connecting...'}
        </span>
        <button className="rounded-md border px-2 py-1" onClick={() => setTakeover((v) => !v)}>
          {takeover ? 'Release control' : 'Take over'}
        </button>
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-black"
        tabIndex={0}
        onMouseDown={(e) => sendMouse('mousePressed', e)}
        onMouseUp={(e) => sendMouse('mouseReleased', e)}
        onMouseMove={(e) => sendMouse('mouseMoved', e)}
        onKeyDown={(e) => sendKey('keyDown', e)}
        onKeyUp={(e) => sendKey('keyUp', e)}
      >
        <img ref={imgRef} alt="live browser viewport" className="h-full w-full object-contain" />
        {takeover && <div className="pointer-events-none absolute inset-0 ring-2 ring-success/60" />}
      </div>
    </div>
  );
}
