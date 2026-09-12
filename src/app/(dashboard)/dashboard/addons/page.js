import { getInstalledSkills } from "@/lib/skillsRegistry";
import AddonsClient from "./AddonsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Add-on Skills",
};

export default async function AddonsPage() {
  const skills = await getInstalledSkills();
  return (
    <div className="p-4 md:p-6 lg:p-8">
      <AddonsClient initialSkills={skills} />
    </div>
  );
}
