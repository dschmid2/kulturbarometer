import type { ItemOrigin, ItemStatus, ItemType, Perspective, Role } from '@kb/shared';

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

export interface Me {
  userId: string;
  email: string | null;
  platformAdmin: boolean;
  organizations: { id: string; name: string; roles: Role[] }[];
}

export interface Member {
  userId: string;
  email: string;
  roles: Role[];
}

export interface Organization {
  id: string;
  name: string;
  memberCount: number;
}
