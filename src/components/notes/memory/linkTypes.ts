import type { NoteLinkType } from '@/types';

/** Link types a person can pick (refers_to is for PatchMan items, added by agents). */
export const LINK_TYPES: NoteLinkType[] = ['depends_on', 'part_of', 'contradicts', 'supersedes', 'example_of', 'related'];
