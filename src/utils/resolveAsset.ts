export function resolveAsset(p: string) {
  return import.meta.env.BASE_URL + 'assets/' + p;
}
