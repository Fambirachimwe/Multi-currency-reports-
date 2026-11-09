import { Link } from 'react-router';
import { PageLayout } from '@/components/layout/page-layout';
import { Button } from '@/components/ui/button';
import { PATHS } from '@/routes/paths';

/** Fallback for any unknown client-side route. */
export function NotFoundPage() {
  return (
    <PageLayout title="Page not found" description="The page you requested does not exist.">
      <div>
        <Button asChild variant="outline" size="sm">
          <Link to={PATHS.dashboard}>Go to Dashboard</Link>
        </Button>
      </div>
    </PageLayout>
  );
}
