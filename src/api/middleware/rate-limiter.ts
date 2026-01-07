import rateLimit from 'express-rate-limit';

export const webhookRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Too many webhook requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
