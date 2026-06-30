// Template store: keeps user-created templates in memory and syncs
// with IndexedDB on init. The `builtinTemplates` list is owned by
// `core/templates/builtin.ts`; this store mirrors it for the UI.
import { create } from 'zustand';
import type { Template } from '../core/types';
import {
  addUserTemplate,
  getAllUserTemplates,
  removeUserTemplate,
} from '../core/templates/user-templates';
import { listBuiltinTemplates } from '../core/templates/builtin';

export interface TemplateState {
  userTemplates: Template[];
  builtinTemplates: Template[];
  /** Bump this after any user-template mutation to force cards to
   *  re-derive their thumbnails. */
  revision: number;
  /** Populate the user template list from IndexedDB. */
  loadUserTemplates: () => Promise<void>;
  addUserTemplate: (template: Template) => Promise<void>;
  removeUserTemplate: (id: string) => Promise<void>;
  setBuiltinTemplates: (templates: Template[]) => void;
}

export const useTemplateStore = create<TemplateState>((set) => ({
  userTemplates: [],
  builtinTemplates: listBuiltinTemplates(),
  revision: 0,

  loadUserTemplates: async () => {
    const list = await getAllUserTemplates();
    set((s) => ({
      userTemplates: list,
      revision: s.revision + 1,
    }));
  },

  addUserTemplate: async (template) => {
    set((s) => ({
      userTemplates: [...s.userTemplates, template],
      revision: s.revision + 1,
    }));
    try {
      await addUserTemplate(template);
    } catch (err) {
      console.warn('[templateStore] failed to persist user template:', err);
    }
  },

  removeUserTemplate: async (id) => {
    set((s) => ({
      userTemplates: s.userTemplates.filter((t) => t.id !== id),
      revision: s.revision + 1,
    }));
    try {
      await removeUserTemplate(id);
    } catch (err) {
      console.warn('[templateStore] failed to delete from IDB:', err);
    }
  },

  setBuiltinTemplates: (templates) => set({ builtinTemplates: templates }),
}));
