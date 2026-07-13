// SelectionFrame: a generic selection chrome with 8 resize handles and an
// optional rotation handle (for image items). It handles mouse events and
// delegates position/size/rotation updates to the document store.
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { ImageItem, OverlayItem } from '../../core/types';
import { useDocumentStore } from '../../store/documentStore';
import { useEditorStore } from '../../store/editorStore';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

const HANDLE_SIZE = 8; // in SVG user units (PDF pt)
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function getOverlayBBox(item: OverlayItem): { x: number; y: number; w: number; h: number } {
  switch (item.type) {
    case 'highlight':
      return item.rect;
    case 'text-block':
    case 'form-field':
      return item.bbox;
    case 'note':
    case 'text':
    case 'image':
      return {
        x: item.position.x,
        y: item.position.y,
        w: item.size.w,
        h: item.size.h,
      };
    case 'drawing':
      // Drawings don't have a natural bbox in the model; we still draw
      // a frame around a 1x1 default. The path itself is the source of truth.
      return { x: 0, y: 0, w: 0, h: 0 };
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

function applyResize(
  item: OverlayItem,
  handle: Handle,
  startBox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number
): Partial<OverlayItem> {
  let { x, y, w, h } = startBox;
  if (handle === 'nw' || handle === 'n' || handle === 'ne') {
    const newY = y + dy;
    h = Math.max(4, h + (y - newY));
    y = newY;
  }
  if (handle === 'sw' || handle === 's' || handle === 'se') {
    h = Math.max(4, h + dy);
  }
  if (handle === 'nw' || handle === 'w' || handle === 'sw') {
    const newX = x + dx;
    w = Math.max(4, w + (x - newX));
    x = newX;
  }
  if (handle === 'ne' || handle === 'e' || handle === 'se') {
    w = Math.max(4, w + dx);
  }

  switch (item.type) {
    case 'highlight':
      return { rect: { x, y, w, h } } as Partial<OverlayItem>;
    case 'text-block':
    case 'form-field':
      return { bbox: { x, y, w, h } } as Partial<OverlayItem>;
    case 'note':
    case 'text':
    case 'image':
      return {
        position: { x, y },
        size: { w, h },
      } as Partial<OverlayItem>;
    default:
      return {};
  }
}

export interface SelectionFrameProps {
  overlay: OverlayItem;
  zoom: number;
}

export function SelectionFrame({ overlay, zoom }: SelectionFrameProps) {
  const updateOverlay = useDocumentStore((s) => s.updateOverlay);
  const setSelectedOverlayId = useEditorStore((s) => s.setSelectedOverlayId);
  const tool = useEditorStore((s) => s.tool);

  const startRef = useRef<{
    box: { x: number; y: number; w: number; h: number };
    pointerX: number;
    pointerY: number;
    mode: 'move' | Handle;
    rotation: number;
    centerX: number;
    centerY: number;
    startAngle: number;
  } | null>(null);

  const box = getOverlayBBox(overlay);
  const isImage = overlay.type === 'image';
  const rotation = isImage ? (overlay as ImageItem).rotation : 0;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  function beginDrag(e: ReactPointerEvent<SVGElement>, mode: 'move' | Handle) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    startRef.current = {
      box: { ...box },
      pointerX: e.clientX,
      pointerY: e.clientY,
      mode,
      rotation,
      centerX: cx,
      centerY: cy,
      startAngle: Math.atan2(e.clientY / zoom - cy, e.clientX / zoom - cx),
    };
  }

  function onMove(e: ReactPointerEvent<SVGElement>) {
    const s = startRef.current;
    if (!s) return;
    const dx = (e.clientX - s.pointerX) / zoom;
    const dy = (e.clientY - s.pointerY) / zoom;

    if (s.mode === 'move') {
      let patch: Partial<OverlayItem>;
      switch (overlay.type) {
        case 'highlight':
          patch = { rect: { x: s.box.x + dx, y: s.box.y + dy, w: s.box.w, h: s.box.h } };
          break;
        case 'text-block':
        case 'form-field':
          patch = { bbox: { x: s.box.x + dx, y: s.box.y + dy, w: s.box.w, h: s.box.h } };
          break;
        case 'note':
        case 'text':
        case 'image':
          patch = {
            position: { x: s.box.x + dx, y: s.box.y + dy },
            size: { w: s.box.w, h: s.box.h },
          };
          break;
        default:
          return;
      }
      updateOverlay(overlay.id, patch);
      return;
    }

    if (s.mode === 'rotate') {
      const angle = Math.atan2(
        e.clientY / zoom - s.centerY,
        e.clientX / zoom - s.centerX
      );
      const delta = ((angle - s.startAngle) * 180) / Math.PI;
      const next = s.rotation + delta;
      if (overlay.type === 'image') {
        updateOverlay(overlay.id, { rotation: next } as Partial<OverlayItem>);
      }
      return;
    }

    // Resize
    const patch = applyResize(overlay, s.mode, s.box, dx, dy);
    if (Object.keys(patch).length > 0) {
      updateOverlay(overlay.id, patch);
    }
  }

  function endDrag(e: ReactPointerEvent<SVGElement>) {
    startRef.current = null;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // For images, wrap the chrome in a rotation group so the frame matches
  // the rotated element. Other items are not rotated.
  const transform = rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined;

  return (
    <g
      transform={transform}
      pointerEvents="all"
      onPointerDown={(e) => {
        e.stopPropagation();
        setSelectedOverlayId(overlay.id);
      }}
    >
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        fill="rgba(37,99,235,0.06)"
        stroke="#2563eb"
        strokeWidth={1 / zoom}
        strokeDasharray={`${4 / zoom} ${3 / zoom}`}
        pointerEvents="all"
        onPointerDown={(e) => beginDrag(e, 'move')}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: tool === 'select' ? 'move' : 'default' }}
      />
      {HANDLES.map((h) => {
        const hx =
          h === 'nw' || h === 'w' || h === 'sw'
            ? box.x
            : h === 'n' || h === 's'
            ? box.x + box.w / 2
            : box.x + box.w;
        const hy =
          h === 'nw' || h === 'n' || h === 'ne'
            ? box.y
            : h === 'w' || h === 'e'
            ? box.y + box.h / 2
            : box.y + box.h;
        const cursor =
          h === 'nw' || h === 'se'
            ? 'nwse-resize'
            : h === 'ne' || h === 'sw'
            ? 'nesw-resize'
            : h === 'n' || h === 's'
            ? 'ns-resize'
            : 'ew-resize';
        return (
          <rect
            key={h}
            x={hx - HANDLE_SIZE / 2}
            y={hy - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            fill="white"
            stroke="#2563eb"
            strokeWidth={1 / zoom}
            style={{ cursor }}
            onPointerDown={(e) => beginDrag(e, h)}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        );
      })}
      {isImage && (
        <g style={{ cursor: 'grab' }}>
          <line
            x1={cx}
            y1={box.y}
            x2={cx}
            y2={box.y - 20}
            stroke="#2563eb"
            strokeWidth={1 / zoom}
          />
          <circle
            cx={cx}
            cy={box.y - 22}
            r={4}
            fill="white"
            stroke="#2563eb"
            strokeWidth={1 / zoom}
            onPointerDown={(e) => beginDrag(e, 'rotate')}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </g>
      )}
    </g>
  );
}
