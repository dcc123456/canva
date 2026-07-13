// ElementRenderer: dispatches SVG rendering for each overlay item type.
import type { OverlayItem } from '../../core/types';

export interface ElementRendererProps {
  overlay: OverlayItem;
  selected?: boolean;
}

export function ElementRenderer({ overlay, selected = false }: ElementRendererProps) {
  switch (overlay.type) {
    case 'highlight': {
      return (
        <rect
          x={overlay.rect.x}
          y={overlay.rect.y}
          width={overlay.rect.w}
          height={overlay.rect.h}
          fill={overlay.color}
          fillOpacity={overlay.opacity}
          pointerEvents="none"
        />
      );
    }
    case 'note': {
      return (
        <g pointerEvents="none">
          <rect
            x={overlay.position.x}
            y={overlay.position.y}
            width={overlay.size.w}
            height={overlay.size.h}
            fill={overlay.color}
            stroke="#a16207"
            strokeWidth={1}
            rx={3}
            ry={3}
          />
          <text
            x={overlay.position.x + 6}
            y={overlay.position.y + 16}
            fontSize={10}
            fill="#1f2937"
          >
            {overlay.text.slice(0, 40)}
          </text>
        </g>
      );
    }
    case 'text': {
      return (
        <g pointerEvents="none">
          <rect
            x={overlay.position.x}
            y={overlay.position.y}
            width={overlay.size.w}
            height={overlay.size.h}
            fill="transparent"
            stroke="#d1d5db"
            strokeDasharray="2,2"
            strokeWidth={0.5}
          />
          <text
            x={overlay.position.x + 2}
            y={overlay.position.y + overlay.fontSize}
            fontSize={overlay.fontSize}
            fontFamily={overlay.font}
            fill={overlay.color}
            fontWeight={overlay.bold ? 700 : 400}
            fontStyle={overlay.italic ? 'italic' : 'normal'}
            textDecoration={overlay.underline ? 'underline' : 'none'}
            transform={`rotate(${overlay.rotation} ${overlay.position.x} ${overlay.position.y})`}
          >
            {overlay.text}
          </text>
        </g>
      );
    }
    case 'image': {
      return (
        <image
          x={overlay.position.x}
          y={overlay.position.y}
          width={overlay.size.w}
          height={overlay.size.h}
          href={`data:${overlay.mime};base64,${overlay.bytes}`}
          transform={`rotate(${overlay.rotation} ${overlay.position.x} ${overlay.position.y})`}
          preserveAspectRatio="none"
          pointerEvents="none"
        />
      );
    }
    case 'drawing': {
      return (
        <path
          d={overlay.path}
          stroke={overlay.color}
          strokeWidth={overlay.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      );
    }
    case 'text-block': {
      // text-block 文字由 PDF.js 在底层 canvas 渲染,正常情况下我们不
      // 再重复渲染 —— 但当用户进入"编辑文字"模式或拖动该 block 时,
      // 底层 canvas 上的原字仍然显示,与编辑浮层 / 拖动后的视觉位置
      // 不一致,所以需要用白色矩形先把底层 canvas 上的原字遮住,再在
      // 上方画 SVG 文字。
      //
      // 注:SelectionFrame 拖动时仅更新 bbox,所以原 PDF.js 的字永远在
      // 原位置不变化;在拖动过程中,我们用 SVG 文字跟随拖动位置渲染。
      const moved =
        overlay.bbox.x !== overlay.originalBbox.x ||
        overlay.bbox.y !== overlay.originalBbox.y ||
        overlay.bbox.w !== overlay.originalBbox.w ||
        overlay.bbox.h !== overlay.originalBbox.h;
      const edited = overlay.text !== overlay.originalText || moved;
      const showOverlay = edited || selected;
      return (
        <>
          {/* 白底画在 originalBbox:盖住 pdfjs canvas 上原位置的原字。
              移动后 originalBbox != bbox,旧位置原字被盖,新位置画新字。 */}
          {showOverlay && (
            <rect
              x={overlay.originalBbox.x}
              y={overlay.originalBbox.y}
              width={overlay.originalBbox.w}
              height={overlay.originalBbox.h}
              fill="white"
              pointerEvents="none"
            />
          )}
          {/* 选中框画在 bbox(当前位置) */}
          <rect
            x={overlay.bbox.x}
            y={overlay.bbox.y}
            width={overlay.bbox.w}
            height={overlay.bbox.h}
            fill="transparent"
            stroke="#60a5fa"
            strokeOpacity={selected ? 0.9 : 0.5}
            strokeWidth={selected ? 0.75 : 0.5}
            strokeDasharray="3 2"
            pointerEvents="none"
          />
          {/* 新字画在 bbox(当前位置) */}
          {showOverlay && (
            <text
              x={overlay.bbox.x}
              y={overlay.bbox.y + overlay.fontSize}
              fontSize={overlay.fontSize}
              fontFamily={overlay.font}
              fill={overlay.color}
              pointerEvents="none"
            >
              {overlay.text}
            </text>
          )}
        </>
      );
    }
    case 'form-field': {
      return (
        <rect
          x={overlay.bbox.x}
          y={overlay.bbox.y}
          width={overlay.bbox.w}
          height={overlay.bbox.h}
          fill="rgba(34,197,94,0.1)"
          stroke="#22c55e"
          strokeWidth={0.5}
          pointerEvents="none"
        />
      );
    }
    default: {
      // Exhaustiveness check
      const _exhaustive: never = overlay;
      return _exhaustive;
    }
  }
}
