// ElementRenderer: dispatches SVG rendering for each overlay item type.
import type { OverlayItem } from '../../core/types';

export interface ElementRendererProps {
  overlay: OverlayItem;
}

export function ElementRenderer({ overlay }: ElementRendererProps) {
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
      return (
        <rect
          x={overlay.bbox.x}
          y={overlay.bbox.y}
          width={overlay.bbox.w}
          height={overlay.bbox.h}
          fill="transparent"
          stroke="#3b82f6"
          strokeWidth={0.5}
          pointerEvents="none"
        />
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
