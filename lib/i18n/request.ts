import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { defaultLocale, isLocale, localeCookie } from './config';

// No locale in the URL: we read the preferred language from a cookie so rider
// links stay clean. Defaults to Swahili.
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const requested = cookieStore.get(localeCookie)?.value;
  const locale = isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
