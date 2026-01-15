import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ApiError } from './error-handler';

const specificationInputSchema = Joi.object({
  // Link-based input (new approach)
  link: Joi.string().uri().optional(),
  
  // Original fields - now optional when link is provided
  title: Joi.string().optional(),
  description: Joi.string().optional(),
  acceptance_criteria: Joi.string().optional(),
  metadata: Joi.object({
    system_type: Joi.string().valid('web', 'api', 'mobile').required(),
    feature_priority: Joi.string().valid('critical', 'high', 'medium', 'low').required(),
    parent_jira_issue_id: Joi.string().required(),
  }).optional(),
  confluence_page_id: Joi.string().optional(),
  confluence_version: Joi.string().optional(),
}).or('link', 'title'); // Either link OR title must be provided

const validationOverrideSchema = Joi.object({
  test_id: Joi.string().required(),
  validation_status: Joi.string().valid('validated', 'needs_review', 'dismissed').required(),
  validation_notes: Joi.string().optional(),
});

export function validateGenerateRequest(req: Request, _res: Response, next: NextFunction): void {
  const { error } = specificationInputSchema.validate(req.body);

  if (error) {
    next(new ApiError(`Invalid request body: ${error.message}`, 400));
  } else {
    next();
  }
}

export function validateValidationOverride(req: Request, _res: Response, next: NextFunction): void {
  const { error } = validationOverrideSchema.validate(req.body);

  if (error) {
    next(new ApiError(`Invalid request body: ${error.message}`, 400));
  } else {
    next();
  }
}
