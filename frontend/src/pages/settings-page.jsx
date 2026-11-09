import { CircleSlash, HelpCircle } from 'lucide-react';
import { DemoNotice } from '@/components/demo-badge';
import { PageLayout } from '@/components/layout/page-layout';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { INTEGRATIONS } from '@/mocks/integrations';

const STATUS = {
  'not-connected': { label: 'Not connected', icon: CircleSlash, variant: 'warning' },
  'not-checked': { label: 'Not checked', icon: HelpCircle, variant: 'default' },
};

/** Read-only integration status placeholder. It has no inputs and shows no endpoints or secrets. */
export function SettingsPage() {
  return (
    <PageLayout
      title="Settings"
      description="Read-only integration status. Credentials are managed on the server and never appear here."
    >
      <DemoNotice>
        Statuses below are static placeholders. No live check was made against any system.
      </DemoNotice>
      <Card>
        <ul className="divide-y" aria-label="Integration status">
          {INTEGRATIONS.map((integration) => {
            const status = STATUS[integration.status];
            const Icon = status.icon;
            return (
              <li key={integration.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text-primary">{integration.name}</p>
                  <p className="text-text-muted">{integration.detail}</p>
                </div>
                <Badge variant={status.variant}>
                  <Icon aria-hidden="true" />
                  {status.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      </Card>
    </PageLayout>
  );
}
