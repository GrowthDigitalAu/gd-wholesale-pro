import { useRevalidator, useRouteLoaderData } from 'react-router';

export default function PlanSelection() {
  const { pricingPlansUrl } = useRouteLoaderData('routes/app');
  const revalidator = useRevalidator();
  return (
    <s-page heading="Select your plan" inlineSize="base">
      <div className="page-frame">
        <s-section heading="Activate GD Wholesale Pro">
          <p className="panel-copy">Choose a plan to start managing your wholesale customers and group pricing.</p>
          <p className="panel-copy">A free plan is available, with free trials on eligible paid plans. Shopify confirms plan pricing and trial eligibility on its secure plan selection page. No charge is approved on this screen.</p>
          <div className="button-row" style={{ marginTop: 16 }}>
            <s-button variant="primary" href={pricingPlansUrl} target="_top">Select your plan</s-button>
            <s-button onClick={() => revalidator.revalidate()} loading={revalidator.state === 'loading'} disabled={revalidator.state !== 'idle'}>Refresh plan status</s-button>
          </div>
        </s-section>
      </div>
    </s-page>
  );
}
