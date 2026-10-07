import { redirect } from 'next/navigation';

export default function CareHomePage(): never {
  redirect('/care/today');
}
