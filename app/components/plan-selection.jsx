import { useRevalidator, useRouteLoaderData } from 'react-router';

export default function PlanSelection() {
  const { pricingPlansUrl } = useRouteLoaderData('routes/app');
  const revalidator = useRevalidator();
  return (
    <s-page heading="Select your plan" inlineSize="base">
      <div className="page-frame">
        <s-section heading="Activate GD Wholesale Pro">
          <p className="panel-copy">Choose a plan to start managing your wholesale customers and group pricing.</p>
          <p className="panel-copy">Free and paid options, pricing, and any eligible trial are confirmed on Shopify&apos;s secure plan selection page. No charge is approved on this screen.</p>
          <div className="button-row">
            <s-button variant="primary" href={pricingPlansUrl} target="_top">Select your plan</s-button>
            <s-button onClick={() => revalidator.revalidate()} loading={revalidator.state === 'loading'} disabled={revalidator.state !== 'idle'}>Refresh plan status</s-button>
          </div>
        </s-section>
      </div>
    </s-page>
  );
}
