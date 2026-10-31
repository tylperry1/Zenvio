import { ClassRegistration } from '@/components/commerce/reservations';
export default async function Page({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { return <ClassRegistration id={(await params).id}/>; }
