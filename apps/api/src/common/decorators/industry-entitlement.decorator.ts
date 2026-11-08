import { SetMetadata } from '@nestjs/common';

export const REQUIRE_CAPABILITY_KEY = 'require_capability';
export const RequireCapability = (capability: string) => SetMetadata(REQUIRE_CAPABILITY_KEY, capability);

export const REQUIRE_INDUSTRY_KEY = 'require_industry';
export const RequireIndustry = (industry: string) => SetMetadata(REQUIRE_INDUSTRY_KEY, industry);
