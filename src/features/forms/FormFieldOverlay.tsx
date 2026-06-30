// features/forms/FormFieldOverlay.tsx
//
// Renders the form-field overlays as native HTML inputs positioned on top
// of the canvas. Inputs are wrapped in an absolutely-positioned container
// whose coordinate system matches the SVG overlay layer (one unit = one
// PDF point). The component does NOT render a check-box for radio options
// from a "real" radio group; instead each option gets its own radio with
// the same `name` (and we set the value on whichever is checked).
import { useDocumentStore } from '../../store/documentStore';
import { useEditorStore } from '../../store/editorStore';
import type { FormFieldItem, PageMeta } from '../../core/types';

export interface FormFieldOverlayProps {
  page: PageMeta;
}

export function FormFieldOverlay({ page }: FormFieldOverlayProps) {
  const zoom = useEditorStore((s) => s.zoom);
  const tool = useEditorStore((s) => s.tool);
  const overlays = useDocumentStore((s) => s.overlays);
  const updateOverlay = useDocumentStore((s) => s.updateOverlay);

  const fields = overlays.filter(
    (o): o is FormFieldItem => o.type === 'form-field' && o.pageId === page.id
  );
  if (fields.length === 0) return null;

  const interactive = tool === 'form';
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: page.width * zoom,
        height: page.height * zoom,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      {fields.map((f) => (
        <FieldControl
          key={f.id}
          field={f}
          zoom={zoom}
          interactive={interactive}
          onChange={(value) => updateOverlay(f.id, { value } as Partial<FormFieldItem>)}
        />
      ))}
    </div>
  );
}

interface FieldControlProps {
  field: FormFieldItem;
  zoom: number;
  interactive: boolean;
  onChange: (value: string | boolean) => void;
}

function FieldControl({ field, zoom, interactive, onChange }: FieldControlProps) {
  const left = field.bbox.x * zoom;
  const top = field.bbox.y * zoom;
  const w = field.bbox.w * zoom;
  const h = field.bbox.h * zoom;
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left,
    top,
    width: w,
    height: h,
    pointerEvents: interactive ? 'auto' : 'none',
    boxSizing: 'border-box',
  };
  switch (field.kind) {
    case 'text': {
      return (
        <input
          type="text"
          value={String(field.value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...baseStyle, border: '1px solid #22c55e', padding: '2px 4px', fontSize: Math.max(10, h * 0.6) }}
        />
      );
    }
    case 'signature': {
      return (
        <input
          type="text"
          placeholder="签名"
          value={String(field.value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...baseStyle, border: '1px dashed #22c55e', padding: '2px 4px', fontStyle: 'italic', fontSize: Math.max(10, h * 0.6) }}
        />
      );
    }
    case 'checkbox': {
      return (
        <input
          type="checkbox"
          checked={!!field.value}
          onChange={(e) => onChange(e.target.checked)}
          style={{ ...baseStyle, width: w, height: h, accentColor: '#22c55e' }}
        />
      );
    }
    case 'radio': {
      const options = field.options ?? ['是', '否'];
      const current = String(field.value ?? '');
      return (
        <div
          style={{
            ...baseStyle,
            display: 'flex',
            flexDirection: w > h * 2 ? 'row' : 'column',
            alignItems: 'center',
            gap: 4,
            border: '1px solid #22c55e',
            padding: 2,
            background: 'rgba(34,197,94,0.04)',
            overflow: 'hidden',
          }}
        >
          {options.map((opt) => (
            <label
              key={opt}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: Math.max(8, h * 0.4) }}
            >
              <input
                type="radio"
                name={field.fieldName}
                value={opt}
                checked={current === opt}
                onChange={() => onChange(opt)}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      );
    }
    case 'select': {
      const options = field.options ?? [];
      return (
        <select
          value={String(field.value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...baseStyle, border: '1px solid #22c55e', padding: '0 2px', fontSize: Math.max(10, h * 0.5) }}
        >
          <option value="" />
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    default: {
      return null;
    }
  }
}
