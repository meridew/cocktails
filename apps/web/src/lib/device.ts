/** Anonymous device id (localStorage) so the bar can push "your drink" back. */
const KEY = 'cocktail_device_id';

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

const NAME_KEY = 'cocktail_name';
export const getSavedName = (): string => localStorage.getItem(NAME_KEY) ?? '';
export const saveName = (name: string): void => localStorage.setItem(NAME_KEY, name);
