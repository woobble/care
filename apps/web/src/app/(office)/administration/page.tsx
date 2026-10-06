import { redirect } from 'next/navigation';

export default function AdministrationPage(): never {
  redirect('/administration/users');
}
