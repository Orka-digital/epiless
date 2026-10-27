import type { APIRoute } from 'astro';
import { getRuntime } from '../../server';
import { handleApi } from '../../server/router';
export const prerender = false;
export const ALL: APIRoute = async (context) => {
  const response = await handleApi(context.request, getRuntime(context));
  return context.request.method === 'HEAD'
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
};
