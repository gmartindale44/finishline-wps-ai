// pages/api/paygate/stripe-validate.js
// Validate Stripe checkout session and issue access cookie
// Called after Stripe redirect with ?success=1&session_id=...

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const { session_id, plan } = body;
    
    if (!session_id) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing session_id' 
      });
    }
    
    // Check if Stripe is configured
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY || 
                            process.env.STRIPE_SECRET_KEY_TEST;
    
    if (!stripeSecretKey) {
      console.warn('[paygate/stripe-validate] Stripe not configured, skipping validation');
      // In monitor mode, allow without validation
      // In enforce mode, this would fail, but we're not in enforce mode yet
      return res.status(200).json({
        ok: true,
        validated: false,
        message: 'Stripe not configured (monitor mode)'
      });
    }
    
    // Validate checkout session
    let Stripe;
    try {
      const stripeModule = await import('stripe');
      Stripe = stripeModule.default;
    } catch (importErr) {
      console.error('[paygate/stripe-validate] Failed to import Stripe:', importErr);
      return res.status(500).json({
        ok: false,
        error: 'Stripe SDK not available'
      });
    }
    
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16'
    });
    
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      
      // Check if payment was successful
      if (session.payment_status !== 'paid') {
        return res.status(400).json({
          ok: false,
          error: 'Payment not completed',
          payment_status: session.payment_status
        });
      }
      
      // Determine plan from session metadata or parameter
      let finalPlan = plan || session.metadata?.plan || 'core';
      if (!['day', 'core', 'family'].includes(finalPlan)) {
        finalPlan = 'core'; // Default
      }
      
      // Calculate duration based on plan
      let durationMs;
      if (finalPlan === 'day') {
        durationMs = 24 * 60 * 60 * 1000; // 24 hours
      } else if (finalPlan === 'family') {
        durationMs = 180 * 24 * 60 * 60 * 1000; // 180 days
      } else {
        durationMs = 30 * 24 * 60 * 60 * 1000; // 30 days (core)
      }
      
      // Issue access cookie
      const { issueAccessCookie } = await import('../../../lib/paygate-server.js');
      const payload = issueAccessCookie(res, {
        plan: finalPlan,
        durationMs,
        tokenVersion: null // Paid plans don't use token version
      });
      
      return res.status(200).json({
        ok: true,
        validated: true,
        plan: payload.plan,
        expiry: payload.expiry,
        payment_status: session.payment_status,
        amount_total: session.amount_total
      });
    } catch (stripeErr) {
      console.error('[paygate/stripe-validate] Stripe API error:', stripeErr);
      return res.status(400).json({
        ok: false,
        error: 'Stripe validation failed',
        details: stripeErr.message
      });
    }
  } catch (err) {
    console.error('[paygate/stripe-validate] Error:', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Internal server error'
    });
  }
}

