/** How long a person's name can be, so it fits beside their messages. */
export const LONGEST_PERSON_NAME = 40;

export const personName = (name: string) => name.trim().slice(0, LONGEST_PERSON_NAME).trim();
