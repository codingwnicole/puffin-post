export default function InboxPage() {
  return (
    <section aria-labelledby="inbox-title">
      <h2 id="inbox-title" className="page-heading">Inbox</h2>
      <p className="page-description">A little order for your next chapter.</p>
      <div className="empty-state">
        <span className="empty-mark" aria-hidden="true">✧</span>
        <h3>A home for your next reply</h3>
        <p>Your Tumblr threads and the replies waiting to happen will appear here.</p>
      </div>
    </section>
  )
}
