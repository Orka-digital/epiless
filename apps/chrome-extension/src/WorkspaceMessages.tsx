/** Present scanner errors and action confirmations with accessible live roles. */
export function WorkspaceMessages({
  error,
  notice,
}: {
  error: string;
  notice: string;
}) {
  return (
    <>
      {' '}
      {error && (
        <div role="alert" className="message error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="message">
          {notice}
        </div>
      )}
    </>
  );
}
