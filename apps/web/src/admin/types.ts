import type { ItemOrigin, ItemStatus, ItemType, Perspective } from '@kb/shared';

export interface FocusSentence {
  id: string;
  text: string;
  position: number;
}

export interface Value {
  id: string;
  name: string;
  description: string;
  focusSentences: FocusSentence[];
}

export interface Item {
  id: string;
  familyId: string;
  versionNumber: number;
  predecessorId: string | null;
  text: string;
  itemType: ItemType;
  perspective: Perspective;
  status: ItemStatus;
  origin: ItemOrigin;
  used: boolean;
  assignments: { valueId: string; valueName: string; weight: number }[];
  updatedAt: string;
}
