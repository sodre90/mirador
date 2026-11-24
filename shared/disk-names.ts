/** A name as a case-insensitive disk compares it: APFS takes `ſ` for `s`, and HFS+ passes over the characters that show nothing. */
export const asDisksCompare = (name: string) => name.replace(/\p{Default_Ignorable_Code_Point}/gu, "").toUpperCase().toLowerCase();
