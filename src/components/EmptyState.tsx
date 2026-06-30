// EmptyState: full-canvas placeholder shown when no PDF has been opened.
// Offers three CTAs:
//   1. 从模板开始 — opens the TemplateGallery
//   2. 打开 PDF   — file picker
//   3. 新建空白文档 — creates a single A4 blank page so the user can start
//                     drawing / typing immediately.
export interface EmptyStateProps {
  onPickTemplate: () => void;
  onOpenFile: (file: File) => void;
  onNewBlank: () => void;
}

export function EmptyState({ onPickTemplate, onOpenFile, onNewBlank }: EmptyStateProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gray-50 px-4">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white text-3xl shadow">
          📄
        </div>
        <h2 className="text-lg font-semibold text-gray-800">
          从空白开始,或选择一个模板
        </h2>
        <p className="mt-1 max-w-md text-sm text-gray-500">
          浏览器内本地编辑,文件不离开你的设备。
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onPickTemplate}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white shadow-sm hover:bg-blue-700"
          >
            从模板开始
          </button>
          <label className="cursor-pointer rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
            打开 PDF
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onOpenFile(f);
              }}
            />
          </label>
          <button
            type="button"
            onClick={onNewBlank}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
          >
            新建空白文档
          </button>
        </div>
      </div>
    </div>
  );
}