import type { Page } from "@playwright/test";

/** Pick a date of birth in the profile's day / month / year dropdowns. */
export async function pickDob(page: Page, day: string, month: string, year: string) {
  const dob = page.getByRole("group", { name: "Date of birth" });
  await dob.getByLabel("Day").selectOption(day);
  await dob.getByLabel("Month").selectOption({ label: month });
  await dob.getByLabel("Year").selectOption(year);
}

/**
 * Fill the admin IST date-time picker (components/admin/ist-date-time-picker.tsx) the way an admin
 * does: a day chip ("Tomorrow") and a quick time chip ("8 PM").
 */
export async function pickIstDateTime(page: Page, group: string, day: string, time: string) {
  const picker = page.getByRole("group", { name: group, exact: true });
  await picker.getByRole("button", { name: new RegExp(`^${day}`) }).click();
  await picker.getByRole("button", { name: time, exact: true }).click();
}
