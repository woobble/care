'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@app/web/auth';

export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect('/');
}
