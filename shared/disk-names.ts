/** A name as a case-insensitive disk compares it: APFS takes `ſ` for `s`, HFS+ passes over the characters that show nothing, and Windows strips trailing dots and spaces. */
export const asDisksCompare = (name: string) => name.replace(/\p{Default_Ignorable_Code_Point}/gu, "").replace(/[. ]+$/, "").toUpperCase().toLowerCase();
